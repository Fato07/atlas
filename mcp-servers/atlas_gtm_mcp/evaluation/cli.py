"""
CLI for RAG Evaluation

Command-line interface for running RAG quality evaluations.
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path
from typing import Optional

import structlog

from .config import EvaluationConfig
from .evaluators.collection_evaluator import CollectionEvaluator, evaluate_collections
from .reporters.json_reporter import JSONReporter
from .reporters.langfuse_reporter import LangfuseReporter, LANGFUSE_AVAILABLE

# Configure structured logging (simple, no stdlib dependency)
structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


def create_parser() -> argparse.ArgumentParser:
    """Create the CLI argument parser."""
    parser = argparse.ArgumentParser(
        prog="rag-evaluate",
        description="Evaluate RAG quality for Atlas GTM collections",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Evaluate all collections
  python -m atlas_gtm_mcp.evaluation.cli evaluate

  # Evaluate specific collection
  python -m atlas_gtm_mcp.evaluation.cli evaluate --collection icp_rules

  # Evaluate with brain filter
  python -m atlas_gtm_mcp.evaluation.cli evaluate --brain-id brain_iro_v1

  # Save report and send to Langfuse
  python -m atlas_gtm_mcp.evaluation.cli evaluate --output ./reports --langfuse

  # Limit samples for quick testing
  python -m atlas_gtm_mcp.evaluation.cli evaluate --max-samples 5
        """,
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Evaluate command
    eval_parser = subparsers.add_parser(
        "evaluate",
        help="Run RAG evaluation",
    )
    eval_parser.add_argument(
        "--collection",
        "-c",
        type=str,
        action="append",
        dest="collections",
        help="Collection(s) to evaluate (can specify multiple). If not specified, evaluates all.",
    )
    eval_parser.add_argument(
        "--brain-id",
        "-b",
        type=str,
        help="Brain ID to filter queries",
    )
    eval_parser.add_argument(
        "--max-samples",
        "-m",
        type=int,
        help="Maximum number of test cases per collection",
    )
    eval_parser.add_argument(
        "--output",
        "-o",
        type=str,
        help="Output directory for JSON reports",
    )
    eval_parser.add_argument(
        "--langfuse",
        action="store_true",
        help="Report results to Langfuse",
    )
    eval_parser.add_argument(
        "--datasets-dir",
        "-d",
        type=str,
        help="Directory containing golden datasets",
    )
    eval_parser.add_argument(
        "--qdrant-url",
        type=str,
        default="http://localhost:6333",
        help="Qdrant server URL (default: http://localhost:6333)",
    )
    eval_parser.add_argument(
        "--fail-on-error",
        action="store_true",
        help="Exit with non-zero code if any evaluation fails",
    )

    # List command
    list_parser = subparsers.add_parser(
        "list",
        help="List available collections and datasets",
    )
    list_parser.add_argument(
        "--datasets-dir",
        "-d",
        type=str,
        help="Directory containing golden datasets",
    )

    return parser


async def run_evaluation(args: argparse.Namespace) -> int:
    """
    Run the evaluation command.

    Args:
        args: Parsed CLI arguments

    Returns:
        Exit code (0 for success, 1 for failure)
    """
    logger.info(
        "Starting RAG evaluation",
        collections=args.collections,
        brain_id=args.brain_id,
        max_samples=args.max_samples,
    )

    # Create configuration
    config = EvaluationConfig(
        qdrant_url=args.qdrant_url,
        max_samples=args.max_samples,
    )

    # Determine datasets directory
    datasets_dir = args.datasets_dir
    if datasets_dir is None:
        datasets_dir = Path(__file__).parent / "datasets"

    # Run evaluation
    try:
        results = await evaluate_collections(
            config=config,
            collection_names=args.collections,
            brain_id=args.brain_id,
            datasets_dir=datasets_dir,
        )
    except Exception as e:
        logger.error("Evaluation failed", error=str(e))
        return 1

    # Print summary
    json_reporter = JSONReporter(output_dir=args.output or Path.cwd() / "reports")
    json_reporter.print_summary(results)

    # Save JSON report if output specified
    if args.output:
        report_path = json_reporter.save_report(results)
        logger.info("Saved JSON report", path=str(report_path))

    # Report to Langfuse if requested
    if args.langfuse:
        if not LANGFUSE_AVAILABLE:
            logger.warning(
                "Langfuse not available - skipping",
                hint="Install with: pip install 'atlas-gtm-mcp[evaluation]'",
            )
        else:
            try:
                langfuse_reporter = LangfuseReporter()
                trace_id = langfuse_reporter.report_aggregated(
                    results=results,
                    brain_id=args.brain_id,
                )
                langfuse_reporter.flush()
                langfuse_reporter.shutdown()
                logger.info("Reported to Langfuse", trace_id=trace_id)
            except Exception as e:
                logger.error("Failed to report to Langfuse", error=str(e))

    # Return exit code
    if args.fail_on_error and not results.overall_passed:
        return 1

    return 0


def run_list(args: argparse.Namespace) -> int:
    """
    Run the list command.

    Args:
        args: Parsed CLI arguments

    Returns:
        Exit code
    """
    # Determine datasets directory
    datasets_dir = args.datasets_dir
    if datasets_dir is None:
        datasets_dir = Path(__file__).parent / "datasets"
    else:
        datasets_dir = Path(datasets_dir)

    print("\n" + "=" * 60)
    print("AVAILABLE GOLDEN DATASETS")
    print("=" * 60)

    if not datasets_dir.exists():
        print(f"\nDatasets directory not found: {datasets_dir}")
        return 1

    # List JSON files
    json_files = list(datasets_dir.glob("*_golden.json"))

    if not json_files:
        print(f"\nNo golden datasets found in {datasets_dir}")
        return 0

    for json_file in sorted(json_files):
        collection_name = json_file.stem.replace("_golden", "")
        print(f"\n  • {collection_name}")
        print(f"    Path: {json_file}")

        # Try to load and show test case count
        try:
            import json
            with open(json_file, "r") as f:
                data = json.load(f)
            test_count = len(data.get("test_cases", []))
            version = data.get("version", "unknown")
            print(f"    Test cases: {test_count}")
            print(f"    Version: {version}")
        except Exception:
            pass

    print("\n" + "=" * 60)
    return 0


def main() -> int:
    """Main entry point."""
    parser = create_parser()
    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        return 0

    if args.command == "evaluate":
        return asyncio.run(run_evaluation(args))
    elif args.command == "list":
        return run_list(args)

    return 0


if __name__ == "__main__":
    sys.exit(main())
