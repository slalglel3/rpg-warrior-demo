#!/usr/bin/env python3
"""Extract game-ready Warrior sprite & 7 articulated 2.5D skeletal parts from D:\\사진\\rpg 직업\\전사 .png.

Uses concept_asset.postprocess (defringe_alpha, tight_crop, slice_nine_patch, pack_sprite_atlas) +
OpenCV seeded flood-fill + SciPy EDT + OpenCV TELEA underlayer inpainting.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, "/home/slalglel/.local/tools/concept-asset-studio")

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt

from concept_asset.postprocess import defringe_alpha, pack_sprite_atlas, save_rgba, slice_nine_patch, tight_crop

REPO = Path(__file__).resolve().parent.parent
SRC_IMAGE = Path("/mnt/d/사진/rpg 직업/전사 .png")
GODOT_ASSETS = REPO / "godot_studio" / "assets"
WEB_ASSETS = REPO / "public" / "assets"
SCRATCH_DIR = Path("/home/slalglel/.gemini/antigravity-cli/brain/a153c74c-551a-41df-9f73-b49cfcca1ebf/scratch")


def extract_clean_male_warrior() -> np.ndarray:
    """Crop Male Warrior (1150x1070) and remove exterior ivory background + baked floor shadow cleanly."""
    full = Image.open(SRC_IMAGE).convert("RGBA")
    crop = full.crop((380, 30, 1530, 1100))
    arr = np.asarray(crop, dtype=np.uint8)
    h, w = arr.shape[:2]

    rgb = arr[..., :3].astype(np.float32)
    bg = np.median(rgb[:24, :24], axis=(0, 1))
    dist = np.linalg.norm(rgb - bg[None, None, :], axis=2)

    hsv = cv2.cvtColor(arr[..., :3], cv2.COLOR_RGB2HSV).astype(np.float32)
    sat = hsv[..., 1]
    val = hsv[..., 2]

    # Exterior background candidates + soft mauve ground shadow around feet (y >= 925):
    # Measured shadow: dist 96..108, S 27..32, V 192..198 vs boot leather dist > 220, S > 100 or ink V < 140
    is_bg_cand = dist < 24.5
    is_shadow_zone = np.zeros((h, w), dtype=bool)
    is_shadow_zone[925:, :] = True
    is_floor_shadow = is_shadow_zone & (dist < 138.0) & (val > 162.0) & (sat < 52.0)

    passable_u8 = ((is_bg_cand | is_floor_shadow).astype(np.uint8) * 255).copy()
    ff = np.zeros((h + 2, w + 2), dtype=np.uint8)

    def try_seed(sx: int, sy: int) -> None:
        if 0 <= sx < w and 0 <= sy < h and passable_u8[sy, sx] == 255 and ff[sy + 1, sx + 1] == 0:
            cv2.floodFill(passable_u8, ff, (sx, sy), 128, flags=4 | (255 << 8) | cv2.FLOODFILL_MASK_ONLY)

    for x in range(w):
        try_seed(x, 0)
        try_seed(x, h - 1)
    for y in range(h):
        try_seed(0, y)
        try_seed(w - 1, y)

    # Seed enclosed pockets between boots / cape / sword grip
    for sy in range(880, 1020, 6):
        for sx in range(615, 745, 6):
            if dist[sy, sx] < 18.0 or (sy >= 925 and dist[sy, sx] < 135.0 and val[sy, sx] > 165.0 and sat[sy, sx] < 50.0):
                try_seed(sx, sy)
    for sy in range(620, 665, 5):
        for sx in range(515, 555, 5):
            if dist[sy, sx] < 14.0:
                try_seed(sx, sy)

    exterior_bg = ff[1:-1, 1:-1] > 0
    alpha = np.where(exterior_bg, 0.0, 255.0).astype(np.float32)

    # Anti-aliased boundary feathering while keeping dark ink outlines solid
    border_dilated = cv2.dilate(exterior_bg.astype(np.uint8), np.ones((5, 5), np.uint8), iterations=1) > 0
    edge_band = border_dilated & (~exterior_bg)
    soft_alpha = np.clip((dist - 18.0) / 22.0, 0.0, 1.0) * 255.0
    is_ink = val < 145.0
    alpha[edge_band] = np.where(is_ink[edge_band], 255.0, np.maximum(soft_alpha[edge_band], 88.0))

    # Strip any remaining 2-3px mauve floor shadow fringe hugging boot bottom
    boot_shadow_trim = is_shadow_zone & edge_band & (dist < 135.0) & (val > 158.0) & (sat < 52.0)
    alpha[boot_shadow_trim] = 0.0

    rgba = arr.copy()
    rgba[..., 3] = np.clip(np.round(alpha), 0, 255).astype(np.uint8)
    defringed = defringe_alpha(Image.fromarray(rgba, "RGBA"), bleed_radius=4, alpha_floor=16, solid_threshold=220)
    return np.asarray(defringed, dtype=np.uint8)


def poly_mask(w: int, h: int, pts: list[tuple[int, int]], feather: float = 1.1) -> np.ndarray:
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    arr = np.asarray(mask, dtype=np.float32)
    if feather > 0.0:
        k = int(max(3, round(feather * 4) | 1))
        arr = cv2.GaussianBlur(arr, (k, k), feather)
    return arr / 255.0


def cut_part(src_rgba: np.ndarray, region_mask: np.ndarray) -> np.ndarray:
    out = src_rgba.copy()
    alpha = out[..., 3].astype(np.float32) * np.clip(region_mask, 0.0, 1.0)
    out[..., 3] = np.clip(np.round(alpha), 0, 255).astype(np.uint8)
    return out


def inpaint_cape_underlayer(cape_rgba: np.ndarray, fill_mask_u8: np.ndarray) -> np.ndarray:
    """Fill the occluded cape area behind the right arm/shoulder strictly from crimson/blue cape pigments."""
    out = cape_rgba.copy()
    a = out[..., 3]
    r = out[..., 0].astype(np.int16)
    g = out[..., 1].astype(np.int16)
    b = out[..., 2].astype(np.int16)

    is_crimson = (r - g > 38) & (r - b > 35) & (r > 95)
    is_blue_cape = (b - r > 22) & (b > 80) & (r < 140)
    cape_pigment = (a >= 220) & (is_crimson | is_blue_cape)

    work_mask = ((fill_mask_u8 > 127) & (a >= 40)).astype(np.uint8) * 255
    seed_valid = cape_pigment & (work_mask == 0)
    if not np.any(seed_valid) or not np.any(work_mask > 0):
        return out

    iy, ix = distance_transform_edt(~seed_valid, return_distances=False, return_indices=True)
    clean_rgb = out[iy, ix, :3]
    bgr = cv2.cvtColor(clean_rgb, cv2.COLOR_RGB2BGR)
    painted_bgr = cv2.inpaint(bgr, work_mask, 12, cv2.INPAINT_TELEA)
    painted_rgb = cv2.cvtColor(painted_bgr, cv2.COLOR_BGR2RGB)
    out[..., :3] = np.where(work_mask[:, :, None] > 0, painted_rgb, out[..., :3])
    return out


def build_parchment_panel_9patch(out_dir: Path) -> None:
    """Create a hand-crafted warrior-style RPG UI panel (charcoal ink + steel bezel + warm gold) and 9-slice it."""
    w, h = 160, 160
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    draw.rounded_rectangle([2, 2, w - 3, h - 3], radius=16, fill=(54, 36, 31, 255))
    draw.rounded_rectangle([6, 6, w - 7, h - 7], radius=13, fill=(138, 146, 162, 255), outline=(218, 224, 236, 255), width=2)
    draw.rounded_rectangle([14, 14, w - 15, h - 15], radius=9, fill=(185, 139, 79, 255), outline=(66, 44, 32, 255), width=2)
    draw.rounded_rectangle([20, 20, w - 21, h - 21], radius=6, fill=(28, 32, 46, 242), outline=(92, 68, 46, 255), width=1)
    for rx, ry in [(16, 16), (w - 17, 16), (16, h - 17), (w - 17, h - 17)]:
        draw.ellipse([rx - 4, ry - 4, rx + 4, ry + 4], fill=(242, 204, 118, 255), outline=(58, 38, 24, 255), width=1)

    panel_src = SCRATCH_DIR / "ui_panel_master.png"
    img.save(panel_src)
    slice_nine_patch(panel_src, left=28, top=28, right=28, bottom=28, out_dir=out_dir / "ui_9patch")


def main() -> None:
    SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
    clean_rgba = extract_clean_male_warrior()
    h, w = clean_rgba.shape[:2]  # 1150 x 1070

    save_rgba(Image.fromarray(clean_rgba, "RGBA"), SCRATCH_DIR / "warrior_full_clean.png")
    tight_full, _ = tight_crop(Image.fromarray(clean_rgba, "RGBA"), pad=8, pivot_mode="bottom_center")
    # Downscale web full sprite cleanly for crisp 2x mobile retina display
    web_full_im = tight_full.resize((int(round(tight_full.width * 0.55)), int(round(tight_full.height * 0.55))), Image.Resampling.LANCZOS)
    save_rgba(web_full_im, WEB_ASSETS / "warrior_full.png")
    save_rgba(tight_full, GODOT_ASSETS / "sprites" / "warrior_full.png")

    portrait_crop = Image.fromarray(clean_rgba[20:490, 440:960], "RGBA")
    portrait_crop, _ = tight_crop(portrait_crop, pad=6)
    portrait_web = portrait_crop.resize((256, int(round(portrait_crop.height * 256 / portrait_crop.width))), Image.Resampling.LANCZOS)
    save_rgba(portrait_web, WEB_ASSETS / "warrior_portrait.png")
    save_rgba(portrait_crop, GODOT_ASSETS / "sprites" / "warrior_portrait.png")

    # 1. Head
    head_poly = [
        (450, 15), (960, 15), (960, 365), (840, 378),
        (760, 405), (675, 400), (610, 368), (540, 360), (450, 310),
    ]
    head_arr = cut_part(clean_rgba, poly_mask(w, h, head_poly, feather=1.2))

    # 2. Left Arm + Shield (screen right)
    left_arm_shield_poly = [
        (782, 355), (955, 355), (1135, 445), (1135, 895),
        (940, 895), (888, 795), (870, 665), (874, 545),
        (815, 515), (782, 460),
    ]
    left_arm_shield_arr = cut_part(clean_rgba, poly_mask(w, h, left_arm_shield_poly, feather=1.1))

    # 3. Right Arm + Broadsword (screen left)
    right_arm_sword_poly = [
        (430, 352), (590, 352), (595, 480), (540, 550),
        (518, 635), (548, 662), (496, 710), (470, 745),
        (462, 795), (410, 815), (45, 1005), (25, 920),
        (355, 668), (360, 622), (408, 622), (445, 515), (438, 425),
    ]
    right_arm_sword_arr = cut_part(clean_rgba, poly_mask(w, h, right_arm_sword_poly, feather=1.0))

    # 4. Right Leg (screen left)
    leg_r_poly = [
        (542, 772), (642, 766), (652, 862), (632, 975),
        (615, 1038), (510, 1038), (528, 920), (536, 835),
    ]
    leg_r_arr = cut_part(clean_rgba, poly_mask(w, h, leg_r_poly, feather=1.0))

    # 5. Left Leg (screen right)
    leg_l_poly = [
        (732, 762), (866, 762), (866, 855), (908, 965),
        (908, 1018), (755, 1018), (748, 920), (728, 842),
    ]
    leg_l_arr = cut_part(clean_rgba, poly_mask(w, h, leg_l_poly, feather=1.0))

    # 6. Cape (ONE continuous flowing cloak behind torso & right arm — no detached leg fragments)
    cape_poly = [
        (135, 430), (595, 430), (605, 815), (520, 845),
        (415, 815), (365, 735), (255, 650), (135, 575),
    ]
    cape_arr = cut_part(clean_rgba, poly_mask(w, h, cape_poly, feather=1.3))
    # Inpaint behind right pauldron/arm/sword-hilt strictly from pure crimson/blue cape pigments
    cape_occ_poly = [
        (395, 425), (600, 425), (600, 745), (535, 760),
        (460, 760), (370, 710), (385, 560), (415, 480),
    ]
    cape_occ_mask = (poly_mask(w, h, cape_occ_poly, feather=0.0) > 0.5).astype(np.uint8) * 255
    cape_arr = inpaint_cape_underlayer(cape_arr, cape_occ_mask)
    # Trim ONLY right-side overlapping belt pouch edge while preserving continuous cape under arm
    cape_trim = poly_mask(w, h, [(555, 665), (615, 665), (615, 830), (555, 830)], feather=1.2)
    cape_arr = cut_part(cape_arr, 1.0 - cape_trim)

    # 7. Body (Armored chestplate + belt + tassets)
    body_erase = np.zeros((h, w), dtype=np.float32)
    body_erase = np.maximum(body_erase, poly_mask(w, h, [
        (0, 0), (1150, 0), (1150, 362), (835, 372),
        (758, 396), (675, 392), (610, 365), (0, 365),
    ], feather=1.2))
    body_erase = np.maximum(body_erase, poly_mask(w, h, [
        (0, 345), (582, 345), (578, 495), (528, 565),
        (515, 650), (545, 690), (495, 765), (495, 1070), (0, 1070),
    ], feather=1.2))
    body_erase = np.maximum(body_erase, poly_mask(w, h, [
        (802, 345), (1150, 345), (1150, 1070), (860, 1070),
        (865, 550), (805, 510),
    ], feather=1.2))
    body_erase = np.maximum(body_erase, poly_mask(w, h, [
        (0, 380), (522, 380), (522, 1070), (0, 1070),
    ], feather=1.2))
    body_erase = np.maximum(body_erase, poly_mask(w, h, [
        (480, 815), (645, 810), (695, 796), (750, 810),
        (920, 815), (920, 1070), (480, 1070),
    ], feather=1.2))
    body_arr = cut_part(clean_rgba, 1.0 - body_erase)

    parts = {
        "cape.png": cape_arr,
        "leg_l.png": leg_l_arr,
        "leg_r.png": leg_r_arr,
        "body.png": body_arr,
        "right_arm_sword.png": right_arm_sword_arr,
        "head.png": head_arr,
        "left_arm_shield.png": left_arm_shield_arr,
    }

    web_scale = 0.55
    web_cropped_paths: list[Path] = []
    web_part_offsets: dict[str, dict] = {}
    web_crop_dir = SCRATCH_DIR / "web_cropped_parts"
    web_crop_dir.mkdir(parents=True, exist_ok=True)

    for fname, arr in parts.items():
        im_part = Image.fromarray(arr, "RGBA")
        # Full-res parts for Godot 4 RiggedActor2D
        save_rgba(im_part, GODOT_ASSETS / "parts" / "warrior" / fname)

        # Scaled & tight-cropped parts for mobile Web Atlas
        scaled_w = int(round(w * web_scale))
        scaled_h = int(round(h * web_scale))
        im_web = im_part.resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)
        cropped, meta = tight_crop(im_web, pad=3)
        crop_path = web_crop_dir / fname
        save_rgba(cropped, crop_path)
        web_cropped_paths.append(crop_path)
        stem = Path(fname).stem
        web_part_offsets[stem] = {
            "x": meta.x,
            "y": meta.y,
            "w": meta.w,
            "h": meta.h,
            "orig_w": meta.orig_w,
            "orig_h": meta.orig_h,
        }

    # Pack tight-cropped parts into compact mobile atlas using concept-asset-studio!
    atlas_manifest = pack_sprite_atlas(
        web_cropped_paths,
        out_png=WEB_ASSETS / "warrior_atlas.png",
        out_json=WEB_ASSETS / "warrior_atlas.json",
        padding=4,
        max_width=1024,
    )
    # Merge canvas placement offsets into atlas manifest
    for stem, frame in atlas_manifest["frames"].items():
        frame["canvas"] = web_part_offsets[stem]
    atlas_manifest["canvas_size"] = [int(round(w * web_scale)), int(round(h * web_scale))]
    (WEB_ASSETS / "warrior_atlas.json").write_text(
        json.dumps(atlas_manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    manifest = {
        "canvas_size": [w, h],
        "web_canvas_size": [int(round(w * web_scale)), int(round(h * web_scale))],
        "web_scale": web_scale,
        "parts_order": [
            "cape.png",
            "leg_l.png",
            "leg_r.png",
            "body.png",
            "right_arm_sword.png",
            "head.png",
            "left_arm_shield.png",
        ],
        "pivots": {
            "root_feet": [685, 995],
            "pelvis": [685, 710],
            "spine": [690, 585],
            "chest": [695, 470],
            "neck": [705, 375],
            "shoulder_r": [540, 445],
            "elbow_r": [480, 565],
            "hand_r": [468, 688],
            "sword_tip": [62, 975],
            "shoulder_l": [835, 435],
            "elbow_l": [870, 565],
            "hand_l": [945, 650],
            "hip_r": [588, 765],
            "knee_r": [585, 868],
            "foot_r": [565, 995],
            "hip_l": [785, 765],
            "knee_l": [805, 862],
            "foot_l": [818, 975],
            "cape_1": [520, 485],
            "cape_2": [375, 575],
            "cape_3": [210, 560],
        },
    }
    for out_json in [
        GODOT_ASSETS / "parts" / "warrior" / "rig_manifest.json",
        WEB_ASSETS / "rig_manifest.json",
    ]:
        out_json.parent.mkdir(parents=True, exist_ok=True)
        out_json.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Remove old huge uncropped parts dir from public/assets if present
    old_parts = WEB_ASSETS / "warrior_parts"
    if old_parts.exists():
        import shutil
        shutil.rmtree(old_parts)

    build_parchment_panel_9patch(WEB_ASSETS)

    vfx_src = Path("/home/slalglel/.gemini/config/skills/godot4-game-studio/resources/textures")
    for png in vfx_src.glob("*.png"):
        im = Image.open(png).convert("RGBA")
        save_rgba(im, WEB_ASSETS / "vfx" / png.name)

    cols = 4
    rows = 2
    cw, ch = 320, 320
    preview = Image.new("RGBA", (cols * cw, rows * ch), (32, 36, 48, 255))
    draw = ImageDraw.Draw(preview)
    items = [("warrior_full", tight_full)] + [(k, Image.fromarray(v, "RGBA")) for k, v in parts.items()]
    for idx, (label, im) in enumerate(items):
        bx = (idx % cols) * cw
        by = (idx // cols) * ch
        for yy in range(by + 28, by + ch - 8, 16):
            for xx in range(bx + 8, bx + cw - 8, 16):
                c = (48, 52, 66, 255) if ((xx // 16 + yy // 16) % 2 == 0) else (62, 68, 86, 255)
                draw.rectangle([xx, yy, min(xx + 15, bx + cw - 8), min(yy + 15, by + ch - 8)], fill=c)
        thumb = im.copy()
        thumb.thumbnail((cw - 20, ch - 42), Image.Resampling.LANCZOS)
        preview.alpha_composite(thumb, (bx + (cw - thumb.width) // 2, by + 32 + (ch - 40 - thumb.height) // 2))
        draw.rectangle([bx, by, bx + cw - 1, by + ch - 1], outline=(185, 145, 85, 255), width=2)
        draw.text((bx + 10, by + 8), label, fill=(255, 224, 140, 255))
    preview.convert("RGB").save(SCRATCH_DIR / "warrior_parts_preview.png")
    print(f"Packed compact atlas: {atlas_manifest['width']}x{atlas_manifest['height']}")


if __name__ == "__main__":
    main()
