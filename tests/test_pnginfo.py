from __future__ import annotations

import io
import unittest

from PIL import Image, PngImagePlugin

from prompt_agent.pnginfo import extract_image_metadata, parse_a1111_parameters


def _png_with_parameters(text: str) -> bytes:
    image = Image.new("RGB", (64, 48), (10, 20, 30))
    info = PngImagePlugin.PngInfo()
    info.add_text("parameters", text)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", pnginfo=info)
    return buffer.getvalue()


class PngInfoTests(unittest.TestCase):
    def test_reads_a1111_parameters_from_png(self) -> None:
        infotext = (
            "a cat, masterpiece\n"
            "Negative prompt: blurry, low quality\n"
            "Steps: 28, Sampler: DPM++ 2M, CFG scale: 7, Seed: 123456, "
            "Size: 512x768, Model hash: abc123, Model: someModel"
        )
        result = extract_image_metadata(_png_with_parameters(infotext))
        self.assertEqual(result["metadata_status"], "available")
        self.assertEqual(result["parser_format"], "a1111")
        self.assertEqual(result["width"], 64)
        self.assertEqual(result["height"], 48)
        data = result["data"]
        self.assertEqual(data["positive_prompt"], "a cat, masterpiece")
        self.assertEqual(data["negative_prompt"], "blurry, low quality")
        params = data["generation_parameters"]
        self.assertEqual(params["steps"], 28)
        self.assertEqual(params["sampler"], "DPM++ 2M")
        self.assertEqual(params["cfg_scale"], "7")
        self.assertEqual(params["seed"], 123456)
        self.assertEqual(params["size"], "512x768")
        self.assertEqual(params["model"], "someModel")
        self.assertEqual(params["model_hash"], "abc123")

    def test_preserves_large_seed_as_string(self) -> None:
        big = 2**53 + 7
        infotext = f"portrait\nSteps: 20, Sampler: Euler, Seed: {big}, Size: 512x512"
        params = parse_a1111_parameters(infotext)["generation_parameters"]
        self.assertEqual(params["seed"], str(big))

    def test_missing_metadata_is_absent(self) -> None:
        buffer = io.BytesIO()
        Image.new("RGB", (8, 8), (0, 0, 0)).save(buffer, format="PNG")
        result = extract_image_metadata(buffer.getvalue())
        self.assertEqual(result["metadata_status"], "absent")
        self.assertEqual(result["parser_format"], "none")
        self.assertIsNone(result["infotext"])

    def test_unreadable_bytes_report_error(self) -> None:
        result = extract_image_metadata(b"not an image at all")
        self.assertEqual(result["metadata_status"], "error")
        self.assertTrue(result["warnings"])


if __name__ == "__main__":
    unittest.main()
