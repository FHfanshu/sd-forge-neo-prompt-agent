"""Command-line entry point so any agent runtime can call the tools via shell.

Examples:

    python -m danbooru_tools search-tags "blue hair" --limit 8
    python -m danbooru_tools search-tags "long hair" "dragon horns" --category character
    python -m danbooru_tools inspect-tags "blue hair" "hatsune miku"
    python -m danbooru_tools related-tags "dragon"
    python -m danbooru_tools search-wikis "tag group attire"
    python -m danbooru_tools inspect-wikis "tag_group:attire"
    python -m danbooru_tools aliases "vored"
    python -m danbooru_tools implications "dragon"
"""

from __future__ import annotations

import argparse
import json
import sys

from .client import (
    inspect_danbooru_tags,
    inspect_danbooru_wikis,
    lookup_danbooru_aliases,
    lookup_danbooru_implications,
    related_danbooru_tags,
    search_danbooru_tags,
    search_danbooru_wikis,
)


def _print(payload: object) -> int:
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def _run(args: argparse.Namespace) -> int:
    if args.command == "search-tags":
        return _print(search_danbooru_tags(queries=args.queries, category=args.category, limit=args.limit))
    if args.command == "inspect-tags":
        return _print(inspect_danbooru_tags(args.names, include_wiki=not args.no_wiki))
    if args.command == "related-tags":
        return _print(related_danbooru_tags(args.name, category=args.category, limit=args.limit))
    if args.command == "search-wikis":
        return _print(search_danbooru_wikis(queries=args.queries, limit=args.limit))
    if args.command == "inspect-wikis":
        return _print(inspect_danbooru_wikis(args.titles))
    if args.command == "aliases":
        return _print(lookup_danbooru_aliases(args.name))
    if args.command == "implications":
        return _print(lookup_danbooru_implications(args.name))
    raise AssertionError(f"unhandled command: {args.command}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="danbooru_tools", description="Danbooru lookup tools for generation agents")
    sub = parser.add_subparsers(dest="command", required=True)

    search_tags = sub.add_parser("search-tags", help="search tags by concepts (batched, up to 12)")
    search_tags.add_argument("queries", nargs="+", help="visual concepts to search")
    search_tags.add_argument("--category", default="", help="general|artist|copyright|character|meta")
    search_tags.add_argument("--limit", type=int, default=12)

    inspect_tags = sub.add_parser("inspect-tags", help="inspect exact tags (wiki body included by default)")
    inspect_tags.add_argument("names", nargs="+")
    inspect_tags.add_argument("--no-wiki", action="store_true", help="skip the wiki body")

    related = sub.add_parser("related-tags", help="related tags for one seed tag")
    related.add_argument("name")
    related.add_argument("--category", default="")
    related.add_argument("--limit", type=int, default=12)

    search_wikis = sub.add_parser("search-wikis", help="search wiki page titles (batched)")
    search_wikis.add_argument("queries", nargs="+")
    search_wikis.add_argument("--limit", type=int, default=12)

    inspect_wikis = sub.add_parser("inspect-wikis", help="read wiki pages (bounded bodies + references)")
    inspect_wikis.add_argument("titles", nargs="+")

    aliases = sub.add_parser("aliases", help="tag aliases involving one tag")
    aliases.add_argument("name")

    implications = sub.add_parser("implications", help="tag implications involving one tag")
    implications.add_argument("name")

    args = parser.parse_args(argv)
    try:
        return _run(args)
    except (ValueError, RuntimeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
