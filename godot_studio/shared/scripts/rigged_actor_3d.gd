class_name RiggedActor3D
extends Node3D
## Reusable Godot 4 controller for Blender-exported .glb skeletal characters.
## Auto-discovers AnimationPlayer + Skeleton3D, sets Loop on *_Loop clips,
## upgrades materials to cel-shaded toon+outline shaders, and exposes bone sockets.

@export var default_idle_clip: String = "Idle_Loop"
@export var crossfade_sec: float = 0.12
@export var rim_color: Color = Color(1.0, 0.45, 0.25, 1.0)
@export var shadow_tint: Color = Color(0.28, 0.20, 0.34, 1.0)
@export var outline_width: float = 0.009
@export var apply_cel_shading_on_ready: bool = true

var anim_player: AnimationPlayer = null
var skeleton: Skeleton3D = null
var _cel_materials: Array[ShaderMaterial] = []
var _flash_tween: Tween = null


func _ready() -> void:
	anim_player = _find_anim_player(self)
	skeleton = _find_skeleton(self)
	_configure_loop_modes()
	if apply_cel_shading_on_ready:
		apply_toon_shader()
	if anim_player != null:
		play_clip(default_idle_clip, 0.0)


func play_clip(clip_name: String, blend: float = -1.0) -> bool:
	if anim_player == null:
		return false
	var target := _resolve_clip_name(clip_name)
	if target.is_empty():
		return false
	var b := crossfade_sec if blend < 0.0 else blend
	anim_player.play(target, b)
	return true


func play_cast_sequence(windup_clip: String, idle_after: String = "") -> void:
	if not play_clip(windup_clip):
		return
	var target_idle := default_idle_clip if idle_after.is_empty() else idle_after
	if anim_player != null and not anim_player.animation_finished.is_connected(_on_oneshot_finished):
		anim_player.animation_finished.connect(_on_oneshot_finished.bind(target_idle), CONNECT_ONE_SHOT)


func _on_oneshot_finished(_finished_name: StringName, return_clip: String) -> void:
	play_clip(return_clip, 0.14)


func trigger_hit_flash(peak: float = 1.0, duration: float = 0.22, hit_clip: String = "Hit_Chest") -> void:
	if not hit_clip.is_empty():
		play_cast_sequence(hit_clip, default_idle_clip)
	if _flash_tween != null and _flash_tween.is_valid():
		_flash_tween.kill()
	_flash_tween = create_tween()
	_set_hit_flash(peak)
	_flash_tween.tween_method(_set_hit_flash, peak, 0.0, duration).set_ease(Tween.EASE_OUT)


func get_socket_world_pos(socket_or_bone: String) -> Vector3:
	if skeleton != null:
		var idx := skeleton.find_bone(socket_or_bone)
		if idx >= 0:
			return skeleton.to_global(skeleton.get_bone_global_pose(idx).origin)
	var direct := find_child(socket_or_bone, true, false)
	if direct is Node3D:
		return (direct as Node3D).global_position
	return global_position + Vector3(0.0, 1.2, 0.0)


func apply_toon_shader(
	cel_shader_path: String = "",
	outline_shader_path: String = ""
) -> void:
	var resolved_cel := cel_shader_path
	if resolved_cel.is_empty():
		for cand in ["res://shared/shaders/toon_cel_outline.gdshader", "res://shaders/toon_cel_outline.gdshader"]:
			if ResourceLoader.exists(cand):
				resolved_cel = cand
				break
	if resolved_cel.is_empty() or not ResourceLoader.exists(resolved_cel):
		return
	var resolved_outline := outline_shader_path
	if resolved_outline.is_empty():
		for cand in ["res://shared/shaders/toon_outline_nextpass.gdshader", "res://shaders/toon_outline_nextpass.gdshader"]:
			if ResourceLoader.exists(cand):
				resolved_outline = cand
				break
	var cel_shader := load(resolved_cel) as Shader
	var outline_shader: Shader = load(resolved_outline) as Shader if (not resolved_outline.is_empty() and ResourceLoader.exists(resolved_outline)) else null
	_cel_materials.clear()
	_upgrade_meshes_recursive(self, cel_shader, outline_shader)


func _upgrade_meshes_recursive(node: Node, cel_shader: Shader, outline_shader: Shader) -> void:
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		if mi.mesh != null:
			for s in range(mi.mesh.get_surface_count()):
				var orig := mi.get_active_material(s)
				var sm := ShaderMaterial.new()
				sm.shader = cel_shader
				sm.set_shader_parameter("rim_color", rim_color)
				sm.set_shader_parameter("shadow_tint", shadow_tint)
				var is_emissive := false
				if orig is BaseMaterial3D:
					var bm := orig as BaseMaterial3D
					sm.set_shader_parameter("albedo_color", bm.albedo_color)
					if bm.albedo_texture != null:
						sm.set_shader_parameter("albedo_tex", bm.albedo_texture)
						sm.set_shader_parameter("use_albedo_tex", true)
					if bm.emission_enabled and bm.emission_energy_multiplier > 0.05:
						sm.set_shader_parameter("emission_color", bm.emission)
						sm.set_shader_parameter("emission_strength", bm.emission_energy_multiplier)
						is_emissive = bm.emission_energy_multiplier > 1.2
				if outline_shader != null and not is_emissive and outline_width > 0.0:
					var om := ShaderMaterial.new()
					om.shader = outline_shader
					om.set_shader_parameter("outline_width", outline_width)
					sm.next_pass = om
				mi.set_surface_override_material(s, sm)
				_cel_materials.append(sm)
	for child in node.get_children():
		_upgrade_meshes_recursive(child, cel_shader, outline_shader)


func _set_hit_flash(v: float) -> void:
	for sm in _cel_materials:
		sm.set_shader_parameter("hit_flash_amount", v)


func _configure_loop_modes() -> void:
	if anim_player == null:
		return
	for lib_name in anim_player.get_animation_library_list():
		var lib := anim_player.get_animation_library(lib_name)
		for anim_name in lib.get_animation_list():
			var anim := lib.get_animation(anim_name)
			var low := String(anim_name).to_lower()
			if low.ends_with("loop") or low == "idle" or low == "run" or low == "walking" or low == "sword_idle":
				anim.loop_mode = Animation.LOOP_LINEAR
			else:
				anim.loop_mode = Animation.LOOP_NONE


func _resolve_clip_name(wanted: String) -> String:
	if anim_player == null:
		return ""
	# Godot glTF importer strips _Loop into -loop / base name (e.g., Idle_Loop -> Idle)
	var candidates: Array[String] = [wanted]
	if wanted.ends_with("_Loop"):
		candidates.append(wanted.trim_suffix("_Loop"))
	for cand in candidates:
		if anim_player.has_animation(cand):
			return cand
	for name in anim_player.get_animation_list():
		var sname := String(name)
		for cand in candidates:
			if sname.ends_with(cand) or sname.contains(cand):
				return sname
	return ""


func _find_anim_player(node: Node) -> AnimationPlayer:
	if node is AnimationPlayer:
		return node as AnimationPlayer
	for c in node.get_children():
		var found := _find_anim_player(c)
		if found != null:
			return found
	return null


func _find_skeleton(node: Node) -> Skeleton3D:
	if node is Skeleton3D:
		return node as Skeleton3D
	for c in node.get_children():
		var found := _find_skeleton(c)
		if found != null:
			return found
	return null
