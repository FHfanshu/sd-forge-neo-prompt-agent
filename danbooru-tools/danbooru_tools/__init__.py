"""Danbooru lookup tools for generation agents.

Stdlib-only client functions plus a small CLI (``python -m danbooru_tools``).
See README.md for usage and provenance.
"""

from .client import (
    DEFAULT_LIMIT,
    DANBOORU_URL,
    inspect_danbooru_tag,
    inspect_danbooru_tags,
    inspect_danbooru_wiki,
    inspect_danbooru_wikis,
    lookup_danbooru_aliases,
    lookup_danbooru_implications,
    related_danbooru_tags,
    search_danbooru_tags,
    search_danbooru_wikis,
)

__all__ = [
    "DANBOORU_URL",
    "DEFAULT_LIMIT",
    "inspect_danbooru_tag",
    "inspect_danbooru_tags",
    "inspect_danbooru_wiki",
    "inspect_danbooru_wikis",
    "lookup_danbooru_aliases",
    "lookup_danbooru_implications",
    "related_danbooru_tags",
    "search_danbooru_tags",
    "search_danbooru_wikis",
]
