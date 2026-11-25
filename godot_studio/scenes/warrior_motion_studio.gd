extends Node2D
## Godot 4.7 2.5D Studio Verification Scene for the Warrior (Skeleton2D + RiggedActor2D + HDR VFX).
## Verifies natural articulated motion (Idle -> Walk Stride -> Sword Cleave -> Shield Guard)
## before deploying identical bone kinematics and HDR VFX into the Web runtime.

const ADDITIVE_SHADER := preload("res://shared/shaders/vfx_additive_scroll.gdshader")
const GROUP_FLASH_SHADER := preload("res://shared/shaders/vfx_canvasgroup_hit_flash.gdshader")
const FBM_NOISE := preload("res://shared/textures/noise_fbm.png")

const TEX_CAPE := preload("res://assets/parts/warrior/cape.png")
const TEX_LEG_L := preload("res://assets/parts/warrior/leg_l.png")
const TEX_LEG_R := preload("res://assets/parts/warrior/leg_r.png")
const TEX_BODY := preload("res://assets/parts/warrior/body.png")
const TEX_ARM_SWORD := preload("res://assets/parts/warrior/right_arm_sword.png")
const TEX_HEAD := preload("res://assets/parts/warrior/head.png")
const TEX_ARM_SHIELD := preload("res://assets/parts/warrior/left_arm_shield.png")

@onready var director: VfxDirector = $VfxDirector
@onready var warrior_root: Node2D = $Arena/WarriorRoot
@onready var warrior_rig: RiggedActor2D = $Arena/WarriorRoot/WarriorRig
@onready var shadow_sprite: Sprite2D = $Arena/WarriorRoot/ShadowOval
@onready var slash_sprite: Sprite2D = $Arena/SlashArc
@onready var ward_aura: Sprite2D = $Arena/WardAura
@onready var state_label: Label = $HudLayer/StateLabel

var _t: float = 0.0
var _slash_done: bool = false
var _guard_done: bool = false
var _rig_mat: ShaderMaterial


func _ready() -> void:
	_build_warrior_rig()
	_setup_materials()
	slash_sprite.visible = false
	ward_aura.visible = false
	_update_poses(0.0)


func _build_warrior_rig() -> void:
	var c_size := Vector2(1150.0, 1070.0)
	warrior_rig.build_skeleton(c_size, [
		{"name": "Pelvis", "parent": "", "pos": Vector2(685, 710)},
		{"name": "Spine", "parent": "Pelvis", "pos": Vector2(690, 585)},
		{"name": "Chest", "parent": "Spine", "pos": Vector2(695, 470)},
		{"name": "Head", "parent": "Chest", "pos": Vector2(705, 375)},
		{"name": "ShoulderR", "parent": "Chest", "pos": Vector2(540, 445)},
		{"name": "ElbowR", "parent": "ShoulderR", "pos": Vector2(480, 565)},
		{"name": "HandR", "parent": "ElbowR", "pos": Vector2(468, 688)},
		{"name": "SwordTip", "parent": "HandR", "pos": Vector2(62, 975)},
		{"name": "ShoulderL", "parent": "Chest", "pos": Vector2(835, 435)},
		{"name": "ElbowL", "parent": "ShoulderL", "pos": Vector2(870, 565)},
		{"name": "HandL", "parent": "ElbowL", "pos": Vector2(945, 650)},
		{"name": "HipR", "parent": "Pelvis", "pos": Vector2(588, 765)},
		{"name": "KneeR", "parent": "HipR", "pos": Vector2(585, 868)},
		{"name": "FootR", "parent": "KneeR", "pos": Vector2(565, 995)},
		{"name": "HipL", "parent": "Pelvis", "pos": Vector2(785, 765)},
		{"name": "KneeL", "parent": "HipL", "pos": Vector2(805, 862)},
		{"name": "FootL", "parent": "KneeL", "pos": Vector2(818, 975)},
		{"name": "Cape1", "parent": "Chest", "pos": Vector2(520, 485)},
		{"name": "Cape2", "parent": "Cape1", "pos": Vector2(375, 575)},
		{"name": "Cape3", "parent": "Cape2", "pos": Vector2(210, 560)},
	])

	warrior_rig.add_skinned_layer("Cape", TEX_CAPE, 0, 14, 12, [
		{"bone": "Chest", "pos": Vector2(565, 465), "radius": 110.0, "weight_scale": 1.6},
		{"bone": "Cape1", "pos": Vector2(485, 520), "radius": 135.0, "weight_scale": 1.4},
		{"bone": "Cape2", "pos": Vector2(345, 580), "radius": 140.0, "weight_scale": 1.3},
		{"bone": "Cape3", "pos": Vector2(205, 555), "radius": 150.0, "weight_scale": 1.5},
	])

	warrior_rig.add_skinned_layer("LegL", TEX_LEG_L, 1, 8, 12, [
		{"bone": "HipL", "pos": Vector2(785, 780), "radius": 95.0, "weight_scale": 1.4},
		{"bone": "KneeL", "pos": Vector2(805, 875), "radius": 100.0, "weight_scale": 1.3},
		{"bone": "FootL", "pos": Vector2(818, 975), "radius": 110.0, "weight_scale": 1.5},
	])

	warrior_rig.add_skinned_layer("LegR", TEX_LEG_R, 2, 8, 12, [
		{"bone": "HipR", "pos": Vector2(588, 780), "radius": 95.0, "weight_scale": 1.4},
		{"bone": "KneeR", "pos": Vector2(585, 875), "radius": 100.0, "weight_scale": 1.3},
		{"bone": "FootR", "pos": Vector2(565, 995), "radius": 110.0, "weight_scale": 1.5},
	])

	warrior_rig.add_skinned_layer("Body", TEX_BODY, 3, 14, 16, [
		{"bone": "Chest", "pos": Vector2(695, 465), "radius": 145.0, "weight_scale": 1.4},
		{"bone": "Spine", "pos": Vector2(690, 585), "radius": 135.0, "weight_scale": 1.3},
		{"bone": "Pelvis", "pos": Vector2(685, 715), "radius": 150.0, "weight_scale": 1.5},
	])

	var sword_rigid := func(uv: Vector2) -> bool:
		return uv.x < 465.0 and uv.y > 625.0

	warrior_rig.add_skinned_layer("RightArmSword", TEX_ARM_SWORD, 4, 16, 16, [
		{"bone": "ShoulderR", "pos": Vector2(540, 445), "radius": 95.0, "weight_scale": 1.4},
		{"bone": "ElbowR", "pos": Vector2(480, 565), "radius": 95.0, "weight_scale": 1.3},
		{"bone": "HandR", "pos": Vector2(468, 688), "radius": 105.0, "weight_scale": 1.5},
	], "HandR", sword_rigid)

	warrior_rig.add_skinned_layer("Head", TEX_HEAD, 5, 8, 8, [], "Head")

	warrior_rig.add_skinned_layer("LeftArmShield", TEX_ARM_SHIELD, 6, 12, 14, [
		{"bone": "ShoulderL", "pos": Vector2(835, 435), "radius": 95.0, "weight_scale": 1.4},
		{"bone": "ElbowL", "pos": Vector2(870, 565), "radius": 95.0, "weight_scale": 1.2},
		{"bone": "HandL", "pos": Vector2(945, 670), "radius": 170.0, "weight_scale": 1.8},
	])


func _setup_materials() -> void:
	_rig_mat = ShaderMaterial.new()
	_rig_mat.shader = GROUP_FLASH_SHADER
	_rig_mat.set_shader_parameter("flash_color", Color(1.0, 0.92, 0.72, 1.0))
	_rig_mat.set_shader_parameter("outline_color", Color(0.35, 0.78, 1.0, 0.75))
	_rig_mat.set_shader_parameter("outline_width", 0.0)
	warrior_rig.material = _rig_mat

	var slash_mat := ShaderMaterial.new()
	slash_mat.shader = ADDITIVE_SHADER
	slash_mat.set_shader_parameter("noise_tex", FBM_NOISE)
	slash_mat.set_shader_parameter("core_color", Color(1.0, 0.94, 0.78, 1.0))
	slash_mat.set_shader_parameter("edge_color", Color(0.95, 0.28, 0.16, 1.0))
	slash_mat.set_shader_parameter("hdr_intensity", 3.2)
	slash_mat.set_shader_parameter("scroll_speed", Vector2(0.5, -0.8))
	slash_sprite.material = slash_mat

	var ward_mat := ShaderMaterial.new()
	ward_mat.shader = ADDITIVE_SHADER
	ward_mat.set_shader_parameter("noise_tex", FBM_NOISE)
	ward_mat.set_shader_parameter("core_color", Color(0.65, 0.95, 1.0, 1.0))
	ward_mat.set_shader_parameter("edge_color", Color(0.18, 0.52, 1.0, 1.0))
	ward_mat.set_shader_parameter("hdr_intensity", 2.4)
	ward_aura.material = ward_mat


func _process(delta: float) -> void:
	_t += delta
	_update_poses(_t)

	if not _slash_done and _t >= 1.72:
		_slash_done = true
		slash_sprite.visible = true
		slash_sprite.rotation = -0.95
		slash_sprite.modulate.a = 1.0
		var tw := create_tween().set_parallel(true)
		tw.tween_property(slash_sprite, "rotation", 1.15, 0.28).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_OUT)
		tw.tween_property(slash_sprite, "modulate:a", 0.0, 0.34).set_delay(0.1)
		director.add_trauma(0.45)
		director.spawn_shockwave(Vector2(760, 410), 0.38, 0.036)

	if not _guard_done and _t >= 2.38:
		_guard_done = true
		ward_aura.visible = true
		ward_aura.modulate.a = 0.85
		_rig_mat.set_shader_parameter("flash_amount", 0.65)
		_rig_mat.set_shader_parameter("outline_width", 1.8)
		var tw := create_tween()
		tw.tween_method(func(v: float) -> void:
			_rig_mat.set_shader_parameter("flash_amount", v)
			_rig_mat.set_shader_parameter("outline_width", 1.8 * v * 1.4),
			0.65, 0.0, 0.36
		)


func _smoothstep(t: float, a: float, b: float) -> float:
	var x := clampf((t - a) / maxf(b - a, 0.001), 0.0, 1.0)
	return x * x * (3.0 - 2.0 * x)


func _update_poses(t: float) -> void:
	var breath := sin(t * 4.2)
	var walk_w := _smoothstep(t, 0.55, 0.72) * (1.0 - _smoothstep(t, 1.38, 1.54))
	var wind_w := _smoothstep(t, 1.48, 1.70) * (1.0 - _smoothstep(t, 1.70, 1.85))
	var slash_w := _smoothstep(t, 1.68, 1.88) * (1.0 - _smoothstep(t, 2.05, 2.30))
	var guard_w := _smoothstep(t, 2.28, 2.48)

	if t < 0.6:
		state_label.text = "2.5D WARRIOR STUDIO · 1. IDLE STANCE"
	elif t < 1.5:
		state_label.text = "2.5D WARRIOR STUDIO · 2. STRIDE WALK"
	elif t < 2.3:
		state_label.text = "2.5D WARRIOR STUDIO · 3. BROADSWORD CLEAVE"
	else:
		state_label.text = "2.5D WARRIOR STUDIO · 4. SHIELD GUARD & FLASH"

	var walk_cyc := sin((t - 0.55) * 11.5)
	var walk_lift_l := maxf(0.0, cos((t - 0.55) * 11.5))
	var walk_lift_r := maxf(0.0, -cos((t - 0.55) * 11.5))

	var hip_y := breath * 5.0 + absf(walk_cyc) * -14.0 * walk_w + 18.0 * wind_w + 12.0 * slash_w + 22.0 * guard_w
	var hip_x := 22.0 * walk_w * walk_cyc - 18.0 * wind_w + 34.0 * slash_w - 12.0 * guard_w
	warrior_rig.set_bone_offset("Pelvis", Vector2(hip_x, hip_y))
	warrior_root.position.x = 590.0 + 130.0 * _smoothstep(t, 0.58, 1.48) + 42.0 * slash_w

	warrior_rig.set_bone_deg("Spine", breath * 1.4 - 10.0 * wind_w + 14.0 * slash_w - 6.0 * guard_w)
	warrior_rig.set_bone_deg("Chest", breath * 1.8 - 12.0 * wind_w + 16.0 * slash_w - 8.0 * guard_w)
	warrior_rig.set_bone_deg("Head", -breath * 1.2 + 8.0 * wind_w - 8.0 * slash_w + 5.0 * guard_w)

	# Alternating leg walk stride + combat lunge
	warrior_rig.set_bone_deg("HipR", -26.0 * walk_cyc * walk_w - 14.0 * slash_w + 10.0 * guard_w)
	warrior_rig.set_bone_deg("KneeR", 24.0 * walk_lift_r * walk_w + 16.0 * slash_w)
	warrior_rig.set_bone_deg("HipL", 26.0 * walk_cyc * walk_w + 18.0 * slash_w - 12.0 * guard_w)
	warrior_rig.set_bone_deg("KneeL", 24.0 * walk_lift_l * walk_w + 14.0 * guard_w)

	# Sword arm: idle poise -> walk swing -> high backswing -> sweeping cleave
	var r_sh := breath * 2.0 + 18.0 * walk_cyc * walk_w - 58.0 * wind_w + 64.0 * slash_w - 16.0 * guard_w
	var r_el := -16.0 * wind_w + 22.0 * slash_w - 12.0 * guard_w
	var r_hd := 4.0 * breath - 24.0 * wind_w + 38.0 * slash_w - 8.0 * guard_w
	warrior_rig.set_bone_deg("ShoulderR", r_sh)
	warrior_rig.set_bone_deg("ElbowR", r_el)
	warrior_rig.set_bone_deg("HandR", r_hd)

	# Shield arm: counter-balance -> pull back on slash -> snap forward on guard
	var l_sh := -breath * 1.5 - 14.0 * walk_cyc * walk_w + 18.0 * wind_w - 22.0 * slash_w + 26.0 * guard_w
	var l_el := -14.0 * slash_w + 20.0 * guard_w
	var l_hd := -8.0 * slash_w + 14.0 * guard_w
	warrior_rig.set_bone_deg("ShoulderL", l_sh)
	warrior_rig.set_bone_deg("ElbowL", l_el)
	warrior_rig.set_bone_deg("HandL", l_hd)

	# Flowing cape lag wave
	var cape_amp := 6.0 + 14.0 * walk_w + 18.0 * slash_w
	warrior_rig.set_bone_deg("Cape1", sin(t * 5.6) * cape_amp - 12.0 * walk_w - 20.0 * slash_w)
	warrior_rig.set_bone_deg("Cape2", sin(t * 5.6 - 0.9) * cape_amp * 1.25 - 10.0 * slash_w)
	warrior_rig.set_bone_deg("Cape3", sin(t * 5.6 - 1.8) * cape_amp * 1.5)

	shadow_sprite.scale = Vector2(1.45 - 0.1 * walk_w, 0.42)
	ward_aura.rotation += 0.02
