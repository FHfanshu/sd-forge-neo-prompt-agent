from __future__ import annotations

import unittest

from prompt_agent.image_index import ImageIndex


class ImageIndexTests(unittest.TestCase):
    def test_groups_images_by_batch_key(self) -> None:
        index = ImageIndex()
        batch = object()
        first = index.record_saved(batch_key=batch, target="txt2img", width=512, height=512, infotext="cat")
        second = index.record_saved(batch_key=batch, target="txt2img", width=512, height=512, infotext="cat")
        third = index.record_saved(batch_key=object(), target="img2img", width=256, height=256)
        self.assertEqual(first.generation_id, second.generation_id)
        self.assertEqual(first.image_id, "gen-1-0")
        self.assertEqual(second.image_id, "gen-1-1")
        self.assertEqual(third.generation_id, "gen-2")
        self.assertEqual(first.metadata_status, "available")
        self.assertEqual(third.metadata_status, "absent")

    def test_list_recent_is_newest_first_and_skips_grids(self) -> None:
        index = ImageIndex()
        batch = object()
        index.record_saved(batch_key=batch, target="txt2img", width=512, height=512, infotext="a")
        index.record_saved(batch_key=batch, target="txt2img", width=512, height=512, infotext="a", is_grid=True)
        index.record_saved(batch_key=batch, target="txt2img", width=512, height=512, infotext="a")
        index.record_saved(batch_key=object(), target="txt2img", width=512, height=512, infotext="b")

        page = index.list_recent(limit=8)
        self.assertEqual(page["returned_count"], 3)
        self.assertEqual(page["items"][0]["generation_id"], "gen-2")
        self.assertEqual(page["items"][1]["generation_id"], "gen-1")
        self.assertEqual(len(page["items"][1]["images"]), 2)

        with_grids = index.list_recent(limit=8, include_grids=True)
        self.assertEqual(with_grids["returned_count"], 4)

    def test_limit_and_find_and_eviction(self) -> None:
        index = ImageIndex(max_batches=2)
        refs = [index.record_saved(batch_key=object(), target="txt2img", width=1, height=1) for _ in range(3)]
        self.assertIsNotNone(index.find(refs[2].image_id))
        self.assertIsNone(index.find(refs[0].image_id))
        self.assertEqual(index.coverage()["batches_tracked"], 2)
        self.assertEqual(index.list_recent(limit=1)["returned_count"], 1)
        index.clear()
        self.assertIsNone(index.find(refs[2].image_id))


if __name__ == "__main__":
    unittest.main()
