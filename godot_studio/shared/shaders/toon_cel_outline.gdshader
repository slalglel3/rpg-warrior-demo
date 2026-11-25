shader_type spatial;
render_mode diffuse_toon, specular_toon, cull_back;

uniform vec4 albedo_color : source_color = vec4(1.0);
uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform bool use_albedo_tex = false;

uniform vec4 shadow_tint : source_color = vec4(0.32, 0.22, 0.36, 1.0);
uniform float shadow_threshold : hint_range(-0.5, 0.5) = 0.08;
uniform float shadow_softness : hint_range(0.005, 0.25) = 0.045;

uniform vec4 rim_color : source_color = vec4(1.0, 0.45, 0.25, 1.0);
uniform float rim_power : hint_range(1.0, 8.0) = 3.5;
uniform float rim_strength : hint_range(0.0, 4.0) = 0.35;

uniform vec4 emission_color : source_color = vec4(0.0, 0.0, 0.0, 1.0);
uniform float emission_strength : hint_range(0.0, 12.0) = 0.0;

uniform vec4 hit_flash_color : source_color = vec4(1.0, 0.92, 0.88, 1.0);
uniform float hit_flash_amount : hint_range(0.0, 1.0) = 0.0;

void fragment() {
	vec3 base = albedo_color.rgb * COLOR.rgb;
	if (use_albedo_tex) {
		base *= texture(albedo_tex, UV).rgb;
	}
	ALBEDO = mix(base, hit_flash_color.rgb, hit_flash_amount);

	float fresnel = pow(1.0 - clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0), rim_power);
	vec3 rim = rim_color.rgb * fresnel * rim_strength;
	vec3 flash_emit = hit_flash_color.rgb * hit_flash_amount * 2.4;
	EMISSION = emission_color.rgb * emission_strength + rim + flash_emit;
	ROUGHNESS = 0.55;
	METALLIC = 0.05;
}

void light() {
	float ndotl = dot(NORMAL, LIGHT);
	float band1 = smoothstep(shadow_threshold - shadow_softness, shadow_threshold + shadow_softness, ndotl * ATTENUATION);
	float band2 = smoothstep(0.55 - shadow_softness, 0.55 + shadow_softness, ndotl * ATTENUATION);
	vec3 tone = mix(shadow_tint.rgb, vec3(0.86), band1);
	tone = mix(tone, vec3(1.0), band2 * 0.32);
	DIFFUSE_LIGHT += ALBEDO * LIGHT_COLOR * tone * 0.58;
}
