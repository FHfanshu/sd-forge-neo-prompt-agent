"""Offline unit tests for danbooru_tools.client (no network access)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from danbooru_tools import client


class FakeApi:
    """Route _request_json calls to canned (path, params) responses."""

    def __init__(self, routes: list[tuple[str, dict, object]]):
        self.routes = routes
        self.calls: list[tuple[str, dict]] = []

    def __call__(self, path, params):
        self.calls.append((path, params))
        for index, (want_path, want_params, response) in enumerate(self.routes):
            if path == want_path and params == want_params:
                self.routes.pop(index)
                return response
        raise AssertionError(f"unexpected API call: {path} {params}")


class NormalizationTests(unittest.TestCase):
    def test_tag_query_normalizes_case_and_spaces(self):
        self.assertEqual("blue_hair", client._tag_query("  Blue Hair "))
        self.assertEqual("black_rock_shooter_(character)", client._tag_query("Black Rock Shooter (character)"))
        with self.assertRaises(ValueError):
            client._tag_query("   ")
        with self.assertRaises(ValueError):
            client._tag_query("x" * 200)

    def test_multi_query_batching_is_deduplicated_and_bounded(self):
        self.assertEqual(["blue_hair", "long_hair"], client._tag_queries(queries=["Blue Hair", "blue hair", "long hair"]))
        with self.assertRaises(ValueError):
            client._tag_queries(queries=[f"tag{i}" for i in range(13)])

    def test_limit_bounds(self):
        self.assertEqual(1, client._limit(0))
        self.assertEqual(12, client._limit(None))
        self.assertEqual(30, client._limit(999))

    def test_wiki_kind_detection(self):
        self.assertEqual("tag_group", client._wiki_kind("tag_groups"))
        self.assertEqual("tag_group", client._wiki_kind("tag_group:attire"))
        self.assertEqual("wiki", client._wiki_kind("blue_hair"))


class TagItemTests(unittest.TestCase):
    def test_tag_item_shape(self):
        item = client._tag_item({
            "id": 7,
            "name": "blue_hair",
            "category": 4,
            "post_count": 12345,
            "is_deprecated": False,
        })
        self.assertEqual("blue hair", item["name"])
        self.assertEqual("blue hair", item["prompt_tag"])
        self.assertEqual("blue_hair", item["canonical_name"])
        self.assertEqual("character", item["category"])
        self.assertEqual(12345, item["post_count"])
        self.assertFalse(item["is_deprecated"])
        self.assertTrue(item["wiki_url"].endswith("/wiki_pages/blue_hair"))

    def test_unknown_category_maps_to_unknown(self):
        item = client._tag_item({"name": "x", "category": 99, "post_count": 1})
        self.assertEqual("unknown", item["category"])


class WikiReferenceTests(unittest.TestCase):
    def test_reference_parsing_and_dedupe(self):
        body = "See [[attire]] and [[tag_group:attire|the attire group]] and [[attire]] again."
        references, truncated = client._wiki_reference_items(body)
        self.assertFalse(truncated)
        self.assertEqual(2, len(references))
        self.assertEqual(("attire", "wiki"), (references[0]["canonical_title"], references[0]["kind"]))
        self.assertEqual(("tag_group:attire", "tag_group"), (references[1]["canonical_title"], references[1]["kind"]))
        self.assertEqual("the attire group", references[1]["label"])

    def test_fragment_links_are_stripped(self):
        references, _ = client._wiki_reference_items("See [[hair#Sections|hair sections]].")
        self.assertEqual(["hair"], [item["canonical_title"] for item in references])


class SearchGroupingTests(unittest.TestCase):
    def test_search_tags_groups_per_query(self):
        tag = {"id": 1, "name": "blue_hair", "category": 0, "post_count": 10}
        base = {"search[hide_empty]": "true", "search[order]": "count", "limit": 12}
        api = FakeApi([
            ("/autocomplete.json", {"search[query]": "blue_hair", "search[type]": "tag_query", "limit": 12}, [{"tag": tag}]),
            ("/tags.json", {**base, "search[name_matches]": "blue_hair*"}, [tag]),
            ("/tags.json", {**base, "search[name_matches]": "*blue*hair*"}, []),
        ])
        original = client._request_json
        client._request_json = api
        try:
            result = client.search_danbooru_tags("blue hair")
        finally:
            client._request_json = original
        self.assertTrue(result["ok"])
        self.assertEqual("blue hair", result["query"])
        self.assertEqual(1, len(result["items"]))
        self.assertEqual("exact", result["items"][0]["match"])

    def test_inspect_tags_reports_missing(self):
        api = FakeApi([
            ("/tags.json", {"search[name_matches]": "no_such_tag_xyz", "limit": 20}, []),
        ])
        original = client._request_json
        client._request_json = api
        try:
            result = client.inspect_danbooru_tag("no such tag xyz", include_wiki=False)
        finally:
            client._request_json = original
        self.assertFalse(result["ok"])
        self.assertIn("error", result)


class RelationshipTests(unittest.TestCase):
    def test_alias_lookup_shapes_both_directions(self):
        from_alias = {"antecedent_name": "old_tag", "consequent_name": "blue_hair", "status": "active", "is_active": True, "forum_topic_id": 5}
        to_alias = {"antecedent_name": "blue_hair_alt", "consequent_name": "blue_hair", "status": "deleted", "is_active": False}
        api = FakeApi([
            ("/tag_aliases.json", {"search[antecedent_name]": "blue_hair", "limit": 30}, [from_alias]),
            ("/tag_aliases.json", {"search[consequent_name]": "blue_hair", "limit": 30}, [to_alias]),
        ])
        original = client._request_json
        client._request_json = api
        try:
            result = client.lookup_danbooru_aliases("blue hair")
        finally:
            client._request_json = original
        self.assertTrue(result["ok"])
        self.assertEqual(1, len(result["aliases_from"]))
        self.assertEqual(1, len(result["aliases_into"]))
        self.assertEqual(5, result["aliases_from"][0]["forum_topic_id"])
        self.assertFalse(result["aliases_into"][0]["is_active"])

    def test_implication_lookup_directions(self):
        forward = {"antecedent_name": "dragon", "consequent_name": "scalie", "status": "active", "is_active": True}
        reverse = {"antecedent_name": "western_dragon", "consequent_name": "dragon", "status": "active", "is_active": True}
        api = FakeApi([
            ("/tag_implications.json", {"search[antecedent_name]": "dragon", "limit": 30}, [forward]),
            ("/tag_implications.json", {"search[consequent_name]": "dragon", "limit": 30}, [reverse]),
        ])
        original = client._request_json
        client._request_json = api
        try:
            result = client.lookup_danbooru_implications("dragon")
        finally:
            client._request_json = original
        self.assertEqual(("dragon", "scalie"), (result["implies"][0]["antecedent_name"], result["implies"][0]["consequent_name"]))
        self.assertEqual("western_dragon", result["implied_by"][0]["antecedent_name"])

    def test_malformed_relationship_entries_are_skipped(self):
        items = client._relationship_items(
            [None, {"antecedent_name": "a"}, {"antecedent_name": "a", "consequent_name": "b"}], ()
        )
        self.assertEqual(
            [{"antecedent_name": "a", "consequent_name": "b", "status": "unknown", "is_active": True}],
            items,
        )


if __name__ == "__main__":
    unittest.main()
