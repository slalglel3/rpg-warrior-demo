class_name RiggedActor2D
extends CanvasGroup
## 2D skeletal cut-out + soft-skinned Polygon2D rig builder for multi-layer illustrations.
## Preserves 100% original character artwork while binding layered grid meshes to a Skeleton2D.

var skeleton: Skeleton2D
var bones: Dictionary = {} # bone_name -> Bone2D
var rest_positions: Dictionary = {} # bone_name -> Vector2 (centered local sprite space)
var _tex_size: Vector2 = Vector2.ONE
var _meshes: Array[Dictionary] = []


func _init() -> void:
	fit_margin = 128.0
	clear_margin = 64.0


func build_skeleton(tex_size: Vector2, bone_specs: Array) -> void:
	## bone_specs: Array of { "name": String, "parent": String, "pos": Vector2 (pixel coords), "length": float }
	_tex_size = tex_size
	if skeleton == null:
		skeleton = Skeleton2D.new()
		skeleton.name = "Skeleton2D"
		add_child(skeleton)

	var half := tex_size * 0.5
	for spec in bone_specs:
		var bname: String = spec["name"]
		var parent_name: String = spec.get("parent", "")
		var pix_pos: Vector2 = spec["pos"]
		var centered_pos := pix_pos - half

		var bone := Bone2D.new()
		bone.name = bname
		bone.set_autocalculate_length_and_angle(false)
		bone.set_length(spec.get("length", 40.0))

		if parent_name.is_empty() or not bones.has(parent_name):
			bone.position = centered_pos
			skeleton.add_child(bone)
		else:
			var parent_global_pix: Vector2 = rest_positions[parent_name]
			bone.position = centered_pos - parent_global_pix
			(bones[parent_name] as Bone2D).add_child(bone)

		bone.rest = bone.transform
		bones[bname] = bone
		rest_positions[bname] = centered_pos


func add_skinned_layer(
	layer_name: String,
	texture: Texture2D,
	z_ord: int,
	grid_cols: int,
	grid_rows: int,
	bone_anchors: Array,
	rigid_bone: String = "",
	rigid_fn: Callable = Callable()
) -> Polygon2D:
	## Subdivides the opaque region of `texture` into a triangle mesh and binds vertex bone weights.
	## bone_anchors: Array of { "bone": String, "pos": Vector2 (pixel coords), "radius": float, "weight_scale": float }
	var img := texture.get_image()
	var w := img.get_width()
	var h := img.get_height()
	var half := Vector2(w, h) * 0.5

	# Tighten mesh bounds strictly around non-transparent pixels of this layer
	var min_x := w
	var min_y := h
	var max_x := 0
	var max_y := 0
	for py in range(0, h, 2):
		for px in range(0, w, 2):
			if img.get_pixel(px, py).a > 0.02:
				min_x = mini(min_x, px)
				min_y = mini(min_y, py)
				max_x = maxi(max_x, px)
				max_y = maxi(max_y, py)
	if min_x >= max_x or min_y >= max_y:
		min_x = 0
		min_y = 0
		max_x = w
		max_y = h

	min_x = maxi(0, min_x - 6)
	min_y = maxi(0, min_y - 6)
	max_x = mini(w, max_x + 6)
	max_y = mini(h, max_y + 6)

	var verts := PackedVector2Array()
	var uvs := PackedVector2Array()
	var step_x := float(max_x - min_x) / float(grid_cols)
	var step_y := float(max_y - min_y) / float(grid_rows)

	for r in range(grid_rows + 1):
		var py := float(min_y) + float(r) * step_y
		for c in range(grid_cols + 1):
			var px := float(min_x) + float(c) * step_x
			uvs.append(Vector2(px, py))
			verts.append(Vector2(px, py) - half)

	var tris: Array = []
	var stride := grid_cols + 1
	for r in range(grid_rows):
		for c in range(grid_cols):
			var cell_has_alpha := _cell_opaque(
				img,
				int(min_x + c * step_x),
				int(min_y + r * step_y),
				int(ceil(step_x)) + 2,
				int(ceil(step_y)) + 2,
				w,
				h
			)
			if not cell_has_alpha:
				continue
			var i0 := r * stride + c
			var i1 := i0 + 1
			var i2 := i0 + stride
			var i3 := i2 + 1
			tris.append(PackedInt32Array([i0, i1, i3]))
			tris.append(PackedInt32Array([i0, i3, i2]))

	var poly := Polygon2D.new()
	poly.name = layer_name
	poly.texture = texture
	# IMPORTANT: CanvasGroup only composites direct children with the SAME z_index (0).
	# Setting non-zero z_index breaks children out of CanvasGroup, disabling outline & hit-flash!
	poly.z_index = 0
	poly.antialiased = true
	poly.polygon = verts
	poly.uv = uvs
	poly.polygons = tris
	add_child(poly)

	poly.skeleton = poly.get_path_to(skeleton)

	# Collect bone list used by this layer
	var active_bones: Array[String] = []
	if not rigid_bone.is_empty():
		active_bones.append(rigid_bone)
	for anch in bone_anchors:
		var bn: String = anch["bone"]
		if not active_bones.has(bn):
			active_bones.append(bn)

	var vcount := verts.size()
	var weight_map := {}
	for bn in active_bones:
		var arr := PackedFloat32Array()
		arr.resize(vcount)
		weight_map[bn] = arr

	for vi in range(vcount):
		var uv_pt := uvs[vi]
		if not rigid_bone.is_empty() and (not rigid_fn.is_valid() or bool(rigid_fn.call(uv_pt))):
			weight_map[rigid_bone][vi] = 1.0
			continue

		var sum_w := 0.0
		var tmp_w := {}
		for anch in bone_anchors:
			var bn: String = anch["bone"]
			var apos: Vector2 = anch["pos"]
			var radius: float = anch.get("radius", 180.0)
			var wscale: float = anch.get("weight_scale", 1.0)
			var d := uv_pt.distance_to(apos)
			var wval := wscale / pow(maxf(d / maxf(radius, 1.0), 0.08), 2.4)
			tmp_w[bn] = tmp_w.get(bn, 0.0) + wval
			sum_w += wval

		if sum_w <= 0.0001:
			weight_map[active_bones[0]][vi] = 1.0
		else:
			for bn in tmp_w.keys():
				weight_map[bn][vi] = float(tmp_w[bn]) / sum_w

	for bn in active_bones:
		var bnode := bones[bn] as Bone2D
		poly.add_bone(skeleton.get_path_to(bnode), weight_map[bn])

	_meshes.append({"poly": poly, "z_ord": z_ord, "order": _meshes.size()})
	_sort_layer_order()
	return poly


func _sort_layer_order() -> void:
	if skeleton != null:
		move_child(skeleton, 0)
	_meshes.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if int(a["z_ord"]) == int(b["z_ord"]):
			return int(a["order"]) < int(b["order"])
		return int(a["z_ord"]) < int(b["z_ord"])
	)
	var base_idx := 1 if skeleton != null else 0
	for i in range(_meshes.size()):
		move_child(_meshes[i]["poly"] as Node, base_idx + i)


func _cell_opaque(img: Image, x0: int, y0: int, cw: int, ch: int, w: int, h: int) -> bool:
	var x1 := mini(w - 1, x0 + cw)
	var y1 := mini(h - 1, y0 + ch)
	var sx := maxi(1, cw / 3)
	var sy := maxi(1, ch / 3)
	for yy in range(maxi(0, y0), y1 + 1, sy):
		for xx in range(maxi(0, x0), x1 + 1, sx):
			if img.get_pixel(xx, yy).a > 0.015:
				return true
	return false


func set_bone_deg(bone_name: String, deg: float) -> void:
	if bones.has(bone_name):
		(bones[bone_name] as Bone2D).rotation_degrees = deg


func set_bone_offset(bone_name: String, delta_pix: Vector2) -> void:
	if bones.has(bone_name):
		var b := bones[bone_name] as Bone2D
		b.position = b.rest.origin + delta_pix


func get_bone_global_pos(bone_name: String) -> Vector2:
	if bones.has(bone_name):
		return (bones[bone_name] as Bone2D).global_position
	return global_position
