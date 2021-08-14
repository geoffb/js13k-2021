"use strict";

/** Size of textures, in pixels */
const TEXTURE_SIZE = 8;

/** Width of camera, in pixels */
const CAMERA_WIDTH = 1024;

/** Height of camera, in pixels */
const CAMERA_HEIGHT = Math.floor(CAMERA_WIDTH / 2);

/** Plane length of camera */
const CAMERA_PLANE_LENGTH = 0.8;

/** Player move speed, in tiles per second */
const PLAYER_MOVE_SPEED = 4;

/** Player rotation speed, in radians per second */
const PLAYER_ROT_SPEED = Math.PI * 1.2;

/** Key code which have their default behavior suppressed */
const SUPPRESS_KEYS = [32, 37, 38, 39, 40, 65, 68, 83, 87];

/** Keyboard state */
const keyboard = {};

/** Time of the last frame */
let last_frame = 0;

/** Canvas 2D drawing surface */
let canvas;
let ctx;

/** Depth buffer */
let depth_buffer;

/** Textures */
const textures = new Image();

/** Simulation map */
let map_width = 0;
let map_height = 0;
let map_tiles;

/** Camera */
let camera_x = 0;
let camera_y = 0;
let camera_facing_x = 1;
let camera_facing_y = 0;
let camera_plane_x = 0;
let camera_plane_y = CAMERA_PLANE_LENGTH;

/** Player entity */
let player;

/** Simulation entities */
const entities = [];

/** Initialize the map to a new size */
function init_map(width, height) {
	map_width = width;
	map_height = height;
	map_tiles = new Uint8Array(map_width * map_height);
}

/** Set the camera position and facing */
function set_camera(x, y, facing_x, facing_y) {
	camera_x = x;
	camera_y = y;
	camera_facing_x = facing_x;
	camera_facing_y = facing_y;
	camera_plane_x = -facing_y * CAMERA_PLANE_LENGTH;
	camera_plane_y = facing_x * CAMERA_PLANE_LENGTH;
}

/** Sync camera to a given entity */
function sync_camera(entity) {
	set_camera(entity.x, entity.y, Math.cos(entity.f), Math.sin(entity.f));
}

/** Handle a keyboard event */
function handle_key(e, state) {
	keyboard[e.keyCode] = !!state;
	if (SUPPRESS_KEYS.indexOf(e.keyCode) !== -1) {
		e.preventDefault();
	}
}

/** Check whether any given keys are down */
function key_down(...keys) {
	for (const key of keys) {
		if (keyboard[key]) { return true; }
	}
	return false;
}

/** Create a new entity */
function make_entity(x, y, facing, sprite) {
	return { x, y, f: facing, s: sprite };
}

/** Cast a ray within the map, and return resulting hit info */
function raycast(ox, oy, dx, dy) {
	const result = { d: 0, s: 0 };

	// Cell coordinates begin at the cell containing the ray's origin
	let x = Math.floor(ox);
	let y = Math.floor(oy);

	const delta_dist_x = Math.sqrt(1 + (dy * dy) / (dx * dx));
	const delta_dist_y = Math.sqrt(1 + (dx * dx) / (dy * dy));

	let side_dist_x = 0;
	let side_dist_y = 0;
	let step_x = 0;
	let step_y = 0;
	let hit = false;

	// Calculate step and side distance
	if (dx < 0) {
		step_x = -1;
		side_dist_x = (ox - x) * delta_dist_x;
	} else {
		step_x = 1;
		side_dist_x = (x + 1.0 - ox) * delta_dist_x;
	}
	if (dy < 0) {
		step_y = -1;
		side_dist_y = (oy - y) * delta_dist_y;
	} else {
		step_y = 1;
		side_dist_y = (y + 1.0 - oy) * delta_dist_y;
	}

	// Perform DDA
	while (!hit) {
		// Jump to next map square
		if (side_dist_x < side_dist_y) {
			side_dist_x += delta_dist_x;
			x += step_x;
			result.s = 0;
		} else {
			side_dist_y += delta_dist_y;
			y += step_y;
			result.s = 1;
		}

		if (x >= 0 && x < map_width && y >= 0 && y < map_height) {
			const i = (y * map_width) + x;
			const value = map_tiles[i];
			if (value !== 0) {
				// Hit a wall
				result.v = value;
				hit = true;
			}
		} else {
			// We hit an invalid cell
			break;
		}
	}

	// Calculate distance projected on camera direction (oblique distance will give fisheye effect!)
	if (result.s === 0) {
		result.d = (x - ox + (1 - step_x) / 2) / dx;
	} else {
		result.d = (y - oy + (1 - step_y) / 2) / dy;
	}

	return result;
}

/** Render the map/world to the canvas */
function render_map() {
	const half_height = CAMERA_HEIGHT / 2;

	// Draw ceiling/sky
	ctx.fillStyle = "#27badb";
	ctx.fillRect(0, 0, CAMERA_WIDTH, half_height);

	// Draw floor
	ctx.fillStyle = "#707070";
	ctx.fillRect(0, half_height, CAMERA_WIDTH, half_height);

	for (let x = 0; x < CAMERA_WIDTH; x++) {
		const cam_x = 2 * x / CAMERA_WIDTH - 1; // x coordinate in camera space

		const ray_x = camera_facing_x + camera_plane_x * cam_x;
		const ray_y = camera_facing_y + camera_plane_y * cam_x;

		const ray = raycast(camera_x, camera_y, ray_x, ray_y);

		const line_height = CAMERA_HEIGHT / ray.d;

		const draw_start = -line_height / 2 + half_height;
		const draw_end = line_height / 2 + half_height;

		let wall_x = 0;
		if (ray.s === 0) {
			wall_x = camera_y + ray.d * ray_y;
		} else {
			wall_x = camera_x + ray.d * ray_x;
		}
		wall_x -= Math.floor(wall_x);

		if (ray.v > 0) {
			// x coordinate on the texture
			let texture_x = Math.floor(wall_x * TEXTURE_SIZE);
			// flip texture x coordinate
			if (
				(ray.s === 0 && ray_x < 0) ||
				(ray.s === 1 && ray_y > 0)
			) {
				texture_x = TEXTURE_SIZE - texture_x - 1;
			}

			// offset texture coordinate within texture
			texture_x += (ray.v - 1) * TEXTURE_SIZE;

			ctx.drawImage(textures, texture_x, 0, 1, TEXTURE_SIZE, x, draw_start, 1, draw_end - draw_start);

			// Shading
			if (ray.s === 1) {
				ctx.fillStyle = "#202040";
				ctx.globalAlpha = 0.5;
				ctx.fillRect(x, draw_start, 1, draw_end - draw_start);
				ctx.globalAlpha = 1;
			}
		}

		// Update depth buffer with the distance of this ray
		depth_buffer[x] = ray.d;
	}
}

/** Render entities to the canvas */
function render_entities() {
	const len = entities.length;
	var order = new Array(len);
	var distance = new Array(len);

	// Determine each entity's distance from the camera
	for (let i = 0; i < len; ++i) {
		const entity = entities[i];
		order[i] = i;
		distance[i] = ((camera_x - entity.x) * (camera_x - entity.x) + (camera_y - entity.y) * (camera_y - entity.y));
	}

	// Sort entities by their distance from the camera
	order.sort(function (a, b) {
		return distance[b] - distance[a];
	});

	// Draw each entity
	for (let i = 0; i < len; ++i) {
		const entity_index = order[i];
		const entity = entities[entity_index];

		if (entity.s === undefined) { continue; }

		const ex = entity.x - camera_x;
		const ey = entity.y - camera_y;

		// Required for correct matrix multiplication
		var inv_det = 1.0 / (camera_plane_x * camera_facing_y - camera_facing_x * camera_plane_y);

		var tx = inv_det * (camera_facing_y * ex - camera_facing_x * ey);
		var ty = inv_det * (-camera_plane_y * ex + camera_plane_x * ey);

		var sx = Math.round((CAMERA_WIDTH / 2) * (1 + tx / ty));

		// Calculate sprite draw height
		const sprite_height = Math.abs(Math.round(CAMERA_HEIGHT / (ty)));
		const draw_start_y = -sprite_height / 2 + CAMERA_HEIGHT / 2;
		const draw_end_y = sprite_height / 2 + CAMERA_HEIGHT / 2;

		// Bail out if sprite is not visible
		if (draw_start_y > CAMERA_HEIGHT || draw_end_y < 0) { continue; }

		// Calculate sprite draw width
		const sprite_width = Math.abs(Math.round(CAMERA_HEIGHT / (ty)));
		const draw_start_x = Math.round(-sprite_width / 2 + sx);
		const draw_end_x = Math.round(sprite_width / 2 + sx);

		// Bail out if sprite is not visible
		if (draw_start_x > CAMERA_WIDTH || draw_end_x < 0) { continue; }

		// Draw sprite in vertical stripes
		for (let x = draw_start_x; x < draw_end_x; ++x) {
			if (ty > 0 && x > 0 && x < CAMERA_WIDTH && ty < depth_buffer[x]) {
				let texture_x = Math.floor((x - (-sprite_width / 2 + sx)) * TEXTURE_SIZE / sprite_width);
				texture_x += entity.s * TEXTURE_SIZE;
				ctx.drawImage(textures,
					texture_x, 0, 1, TEXTURE_SIZE,
					x, ~~draw_start_y, 1, ~~(draw_end_y - draw_start_y));
			}
		}
	}
}

/** Handle user input */
function input(dt) {
	const facing_x = Math.cos(player.f);
	const facing_y = Math.sin(player.f);
	const move_distance = PLAYER_MOVE_SPEED * dt;
	const rot_distance = PLAYER_ROT_SPEED * dt;
	if (key_down(38, 87)) {
		player.x += facing_x * move_distance;
		player.y += facing_y * move_distance;
	} else if (key_down(40, 83)) {
		player.x -= facing_x * move_distance;
		player.y -= facing_y * move_distance;
	}
	if (key_down(37, 65)) {
		player.f -= rot_distance;
	} else if (key_down(39, 68)) {
		player.f += rot_distance;
	}
}

/** Frame handler */
function frame(time) {
	const dt = (time - last_frame) / 1000;
	last_frame = time;
	input(dt);
	// TODO: Update simulation
	sync_camera(player);
	render_map();
	render_entities();
	requestAnimationFrame(frame);
}

/** Scale drawing surface to the window size, maintaining aspect ratio */
function scale_canvas() {
	// Viewport width
	const width = window.innerWidth;
	const height = window.innerHeight;

	// Determine scale while maintaining aspect ratio
	const scale = Math.min(width / canvas.width, height / canvas.height);

	// Calculate centered position for scaled canvas
	const left = width / 2 - (canvas.width / 2 * scale);
	const top = height / 2 - (canvas.height / 2 * scale);

	// Apply styles
	canvas.style.width = `${canvas.width * scale}px`;
	canvas.style.height = `${canvas.height * scale}px`;
	canvas.style.left = `${left}px`;
	canvas.style.top = `${top}px`;
}

/** Main entry point */
function main() {
	// Load textures
	textures.src = "textures.png";

	// Initialize depth buffer
	depth_buffer = new Array(CAMERA_WIDTH);

	// Initialize drawing surface
	canvas = document.createElement("canvas");
	canvas.width = CAMERA_WIDTH;
	canvas.height = Math.floor(CAMERA_WIDTH / 2);
	canvas.style.position = "absolute";
	document.body.appendChild(canvas);
	scale_canvas();
	window.onresize = scale_canvas;
	ctx = canvas.getContext("2d");
	ctx.imageSmoothingEnabled = false;

	// Init map
	init_map(20, 20);
	for (let i = 0; i < map_tiles.length; i++) {
		const x = i % map_width;
		const y = Math.floor(i / map_width);
		if (x === 0 || x === map_width - 1 || y === 0 || y === map_height - 1) {
			map_tiles[i] = 1;
		} else {
			map_tiles[i] = Math.random() > 0.1 ? 0 : 1;
			if (map_tiles[i] === 0 && Math.random() < 0.05) {
				entities.push(make_entity(x + 0.5, y + 0.5, 0, 1));
			}
		}
	}

	// Init player
	player = make_entity(1.5, 1.5, 0);
	entities.push(player);

	// Set camera position
	sync_camera(player);

	// Detect keyboard state
	window.onkeydown = (e) => handle_key(e, true);
	window.onkeyup = (e) => handle_key(e);

	// Start the main loop
	last_frame = performance.now();
	frame(last_frame);
}

// Execute program
main();
