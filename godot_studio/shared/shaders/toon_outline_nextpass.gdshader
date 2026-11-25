shader_type spatial;
render_mode cull_front, unshaded, shadows_disabled;

uniform vec4 outline_color : source_color = vec4(0.06, 0.03, 0.08, 1.0);
uniform float outline_width : hint_range(0.0, 0.08) = 0.012;

void vertex() {
	// Scale-invariant extrusion: divide by world basis length so cm-scaled (100x) GLB rigs get true world-meter outlines.
	float n_len = length(NORMAL);
	if (n_len > 0.0001) {
		float model_scale = max(length(MODEL_MATRIX[0].xyz), 0.001);
		VERTEX += (NORMAL / n_len) * (outline_width / model_scale);
	}
}

void fragment() {
	ALBEDO = outline_color.rgb;
}
