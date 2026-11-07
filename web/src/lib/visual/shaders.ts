/**
 * GLSL for the stage (T4.2.2 to T5.7). Plain strings so they can live in the lazily loaded Three.js chunk.
 *
 * Everything the notes need is derived on the GPU from the instance data and one time uniform: the CPU does
 * no per-note work per frame. The keyboard layout and the voice-lane layout are both computed in `place()`
 * and blended by `uMix`, so a change of layout is a morph (a uniform ramp), not a rebuild.
 *
 * Colours are written straight to the framebuffer in sRGB (no colour-space conversion), premultiplied:
 * alpha 0 with colour added is an additive glow.
 *
 * The per-piece scenes (E5) are the same shaders with a few strengths turned up: ribbons, colour by theme, highlighted
 * subject entries, the white BACH notes, the mirror ghost (a second draw of the notes, `GHOST`), shockwaves and canon links.
 */

/** shared by every shader that places things in the scene */
export const COMMON = /* glsl */ `
uniform float uTime;      // playhead, seconds
uniform float uHold;      // the notes stand still at this playhead time (the ending); 1e9 = never
uniform float uDim;       // everything fades to black as this goes from 1 to 0 (the ending)
uniform float uNoteFade;  // the notes alone: 1, then 0 when they shatter (the ending)
uniform float uSpeed;     // world units per second
uniform float uMix;       // 0 = keyboard layout, 1 = voice lanes
uniform float uVoices;    // voices in the current piece
uniform vec3  uVoice[5];  // colour per voice
uniform float uMedian[5]; // median pitch per voice, to centre each lane
uniform vec3  uTheme[7];  // colour of themes S1 to S6, then of notes that belong to no theme
uniform float uThemeMix;  // 0 = colour by voice, 1 = colour by theme
uniform float uFlip;      // mirror flip: 1 = as written, -1 = mirrored about the axis, in between = turning over
uniform float uFlipX;     // x of the mirror axis on the keyboard
uniform float uFlipP;     // pitch of the mirror axis

const float HIT_X = -17.0;     // lanes: x of the hit line
const float LANE_H = 4.6;      // lanes: distance between lane centres
const float LANE_MUL = 2.0;    // lanes: time runs this much faster along x than along y in the keyboard layout
const float LANE_ACROSS = 0.34;// lanes: thickness scale
const float LANE_PITCH = 0.17; // lanes: world units per semitone inside a lane

int voiceIndex(float voice) { return int(clamp(voice - 1.0, 0.0, 4.0) + 0.5); }

// the listener's voice toggles (T7.3.1): 1 = shown, 0 = hidden, in between while it fades
uniform float uVoiceShow[5];
float voiceShow(float voice) { return uVoiceShow[voiceIndex(voice)]; }

// the playhead as the notes see it: it stops at uHold
float noteTime() { return min(uTime, uHold); }

// The two layouts use perpendicular axes, so there is no sensible in-between shape. A layout change is a dip
// crossfade: before the middle everything is laid out as the keyboard, after it as lanes, and the notes fade out
// and back in around the middle (layoutAlpha is 1 at either end and 0 in the middle).
float layoutAlpha() { return smoothstep(0.0, 0.7, abs(uMix * 2.0 - 1.0)); }

// colour of a note: its voice's, or its theme's (a note of no theme is a quiet neutral that leans on its voice)
vec3 noteColour(vec3 voiceCol, float theme) {
  float themed = step(0.5, theme);
  int ti = int(clamp(theme - 1.0, 0.0, 5.0) + 0.5);
  vec3 byTheme = mix(mix(voiceCol, uTheme[6], 0.7), uTheme[ti], themed);
  return mix(voiceCol, byTheme, uThemeMix);
}

// along: distance from the hit line in the direction of time; across: offset sideways
vec3 place(float x, float along, float across, float voice, float pitch) {
  float z = voice * 0.002;
  // while the mirror turns over, what is far away turns first and what is at the hit line stays with the keys
  float s = uFlip > 0.999 ? 1.0 : mix(1.0, uFlip, smoothstep(0.0, 4.0, along));
  vec3 pk = vec3(uFlipX + (x - uFlipX) * s + across, along, z);
  float p = uFlipP + (pitch - uFlipP) * s;
  float laneY = ((uVoices - 1.0) * 0.5 - (voice - 1.0)) * LANE_H + (p - uMedian[voiceIndex(voice)]) * LANE_PITCH;
  vec3 pl = vec3(HIT_X + along * LANE_MUL, laneY + across * LANE_ACROSS, z);
  return uMix >= 0.5 ? pl : pk;
}
`;

export const NOTE_VERT = /* glsl */ `
${COMMON}
attribute vec4 aNote; // x, t_on, t_off, voice
attribute vec4 aMeta; // velocity 0..1, flags, pitch, key width
attribute vec4 aGhost;// x, pitch, key width of the note's mirror counterpart (pitch 0: none)
attribute vec4 aTag;  // scene tag bits, theme, time-scaling class, has tags
uniform float uAhead;
uniform float uBehind;
uniform float uHighlight; // highlight subject entries, mark inverted ones
uniform float uRibbons;   // notes are ribbons, sized by the time scaling of their statement
uniform float uVoiceE[5]; // energy of each voice from the note data (T6.3.2): drives the glow
uniform float uBach;      // light up the BACH notes
uniform float uGhost;     // strength of the mirror ghost

varying vec2 vLocal;  // position in the rectangle's own units, centre = 0
varying vec2 vHalf;   // half extents of the rectangle
varying vec3 vColor;
varying vec4 vState;  // active 0..1, ended 0..1, flare, distance fade
varying float vOrnament;
varying float vAlong; // 0 at the bottom edge, 1 at the top
varying vec4 vScene;  // subject, inverted, bach, additive amount
varying vec4 vRib;    // ribbon amount, wave frequency, wave speed, phase
varying float vVoiceE; // energy of this note's voice (from the notes), 0..1

const float END_FADE = 0.28;
const float PAD = 0.32;
const float MIN_DUR = 0.09;

void main() {
  float tn = noteTime();
  float dOn = aNote.y - tn;
  float dur = max(aNote.z - aNote.y, MIN_DUR);
  float dOff = dOn + dur;
#ifdef GHOST
  if (aGhost.y < 0.5 || uGhost <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float nx = aGhost.x;
  float npitch = aGhost.y;
  float nwidth = aGhost.z;
#else
  float nx = aNote.x;
  float npitch = aMeta.z;
  float nwidth = aMeta.w;
#endif
  if (dOn > uAhead || dOff < -END_FADE) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  float bits = aTag.x;
  float subj = mod(bits, 2.0);
  float inv = mod(floor(bits / 2.0), 2.0);
  float bach = mod(floor(bits / 4.0), 2.0);
  float theme = aTag.y;
  float ratio = aTag.z;
  float has = aTag.w;

  float bot = max(dOn, 0.0) * uSpeed;
  float top = max(max(dOff, 0.0) * uSpeed, bot + mix(0.07, 0.24, uRibbons));   // a ribbon needs some length to wave
  float act = step(dOn, 0.0) * step(0.0, dOff);
  float ended = clamp(-dOff / END_FADE, 0.0, 1.0);

  // ribbons: a statement in augmentation (ratio class 2) is thick and slow, one in diminution (class 1) thin and fast
  float wide = ratio > 1.5 ? 1.8 : (ratio > 0.5 ? 0.5 : 1.0);
  vRib = vec4(uRibbons, ratio > 1.5 ? 2.5 : (ratio > 0.5 ? 12.0 : 6.0), ratio > 1.5 ? 0.8 : (ratio > 0.5 ? 5.0 : 2.5), aNote.y * 1.7);

  float grace = mod(aMeta.y, 2.0);
  float hw = nwidth * 0.5 * 0.9 * mix(1.0, 0.6, grace) * mix(1.0, wide, uRibbons);
  float hh = (top - bot) * 0.5;
  vHalf = vec2(hw, hh);

  vec2 q = position.xy + 0.5;                            // 0..1 over the padded quad
  float across = (q.x * 2.0 - 1.0) * (hw + PAD);
  float along = bot - PAD + q.y * (top - bot + 2.0 * PAD);
  vLocal = vec2(across, along - (bot + top) * 0.5);
  vAlong = clamp((along - bot) / max(top - bot, 1e-4), 0.0, 1.0);

  vec3 base = uVoice[voiceIndex(aNote.w)];
  vColor = noteColour(base, theme);
  float themed = step(0.5, theme);
  float age = max(-dOn, 0.0);
  float flare = aMeta.x * exp(-age / 0.13) * step(0.0, -dOn);
  float far = 1.0 - smoothstep(0.78, 1.0, dOn / uAhead);
  // with highlights on, notes outside the subject entries step back a little (only once the piece's tags are known)
  float stepBack = 1.0 - 0.3 * uHighlight * has * (1.0 - subj);
  float vis = far * layoutAlpha() * stepBack * uDim * uNoteFade * voiceShow(aNote.w);
#ifdef GHOST
  vis *= uGhost;
#endif
  vState = vec4(act, ended, flare, vis);
  vOrnament = step(0.5, mod(floor(aMeta.y * 0.5), 32.0));
  vScene = vec4(subj * uHighlight, inv * uHighlight, bach * uBach, uThemeMix * themed);
  vVoiceE = uVoiceE[voiceIndex(aNote.w)];

  vec3 p = place(nx, along, across, aNote.w, npitch);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const NOTE_FRAG = /* glsl */ `
uniform float uGlow;
uniform float uTime;
varying vec2 vLocal;
varying vec2 vHalf;
varying vec3 vColor;
varying vec4 vState;
varying float vOrnament;
varying float vAlong;
varying vec4 vScene;
varying vec4 vRib;
varying float vVoiceE;

void main() {
  // a ribbon is a capsule with a wavy edge; a plain note a rounded rectangle
  float rib = vRib.x;
  float rmax = min(vHalf.x, vHalf.y);
  float r = mix(min(0.14, rmax), min(rmax, 0.07), rib);
  vec2 l = vLocal;
  l.x += sin(l.y * vRib.y + vRib.w + uTime * vRib.z) * 0.14 * min(vHalf.x, 0.5) * rib;
  vec2 q = abs(l) - vHalf + r;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;   // < 0 inside
  float aa = max(fwidth(d), 1e-4);
  float fill = 1.0 - smoothstep(-aa, aa, d);

  float act = vState.x;
  float ended = vState.y;
  float flare = vState.z;
  float far = vState.w;
  float life = (1.0 - ended) * far;
  float rim = smoothstep(-0.075, -0.035, d) * fill;               // a band just inside the edge

#ifdef GHOST
  // the mirror counterpart: a faint outline with a barely filled body
  float ga = (0.1 * fill + 0.5 * rim) * life;
  gl_FragColor = vec4(vColor * ga, ga);
#else
  float subj = vScene.x;
  float inv = vScene.y;
  float bach = vScene.z;
  float add = vScene.w;

  float lead = 1.0 - vAlong;                                     // brighter at the leading (bottom) edge
  vec3 col = vColor * (0.70 + 0.30 * lead) * (1.0 + 0.55 * act);
  if (vOrnament > 0.5) {
    float s = 0.5 + 0.5 * sin((vLocal.y + vLocal.x) * 26.0);
    col *= 0.62 + 0.38 * s;                                      // ornamented notes are striped
  }
  col += vec3(1.0) * flare * 0.7 * smoothstep(0.55, 0.0, 1.0 - lead);
  col = mix(col, vec3(1.0), 0.18 * act);

  col *= 1.0 + 0.5 * subj;                                       // subject entries are brighter
  col = mix(col, col * 0.4, inv);                                // an inverted entry is hollow with a bright rim
  col = mix(col, vec3(1.0), rim * inv * 0.95);
  col *= 1.0 + 0.45 * add;                                       // themes add up where they overlap
  col = mix(col, vec3(1.0), bach * (0.3 + 0.7 * act) * 0.92);    // the BACH notes are white

  vec3 haloCol = mix(vColor, vec3(1.0), bach);
  float halo = pow(max(1.0 - max(d, 0.0) / 0.32, 0.0), 2.0) * uGlow * (0.16 + 0.55 * act + 0.5 * flare) * life;
  halo *= 1.0 + 0.8 * subj + 1.2 * bach * act;
  halo *= 1.0 + 0.9 * vVoiceE * (1.0 - act) * (1.0 - bach);   // a voice that is playing hard: the notes coming for it glow more (sounding notes keep their look)
  float a = fill * life * (1.0 - 0.65 * add);
  gl_FragColor = vec4(col * a + haloCol * halo, a);
#endif
}
`;

/** Soft tapering streak behind each note (T4.3.2); width follows the note's duration. */
export const TRAIL_VERT = /* glsl */ `
${COMMON}
attribute vec4 aNote;
attribute vec4 aMeta;
attribute vec4 aTag;
uniform float uAhead;
uniform float uTrail;      // 0..1 strength

varying vec3 vColor;
varying float vAlpha;

void main() {
  float dOn = aNote.y - noteTime();
  float dur = max(aNote.z - aNote.y, 0.09);
  float dOff = dOn + dur;
  if (uTrail <= 0.001 || dOn > uAhead || dOff < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  float bot = max(dOn, 0.0) * uSpeed;
  float top = max(max(dOff, 0.0) * uSpeed, bot + 0.07);
  float v = position.y + 0.5;                                    // 0 at the note, 1 at the tip
  float len = 0.75 * uSpeed;
  float w0 = clamp(0.05 + 0.5 * dur, 0.05, 1.1);                 // thickness proportional to duration
  float half_w = w0 * pow(1.0 - v, 0.6);
  float along = top + v * len;
  float across = position.x * 2.0 * half_w;

  vColor = noteColour(uVoice[voiceIndex(aNote.w)], aTag.y);
  float far = 1.0 - smoothstep(0.7, 1.0, (dOn + v * 0.75) / uAhead);
  vAlpha = uTrail * 0.4 * pow(1.0 - v, 1.6) * far * (0.5 + 0.5 * aMeta.x) * layoutAlpha() * uDim * uNoteFade * voiceShow(aNote.w);

  vec3 p = place(aNote.x, along, across, aNote.w, aMeta.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const TRAIL_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vColor * vAlpha, 0.0);                     // additive
}
`;

/**
 * Piano keys (T4.2.1, T4.2.4), looked at as on a concert grand (a Hamburg Steinway D, a Bösendorfer Imperial): ivory-white
 * keys with a polished front edge and dark gaps between them, ebony black keys that are narrower at the top with a sloping
 * front, polished to a mirror finish that reflects a studio softbox, and key blocks, key slip and key bed in black
 * piano lacquer (`LACQUER_*`). The keys depress about their back end, so a pressed key is lower at the front.
 */
export const KEY_VERT = /* glsl */ `
attribute vec4 aKey;    // x, isBlack, width, -
attribute vec4 aState;  // voice, press, glow, flare
uniform float uKeyH;
uniform vec3 uVoice[5];
uniform float uVoiceShow[5];
uniform vec3 uWhite;
uniform vec3 uBlack;

varying vec3 vCol;
varying vec3 vNormal;
varying vec3 vFlareCol;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vBlack;

void main() {
  float black = aKey.y;
  float w = aKey.z * mix(0.94, 1.0, black);
  float len = mix(uKeyH, uKeyH * 0.64, black);
  float depth = mix(0.45, 0.8, black);
  float press = aState.y;
  vec3 lp = position;               // -0.5 .. 0.5 over the box
  float topk = lp.z + 0.5;          // 0 at the bottom, 1 at the top
  float front = lp.y < 0.0 ? 1.0 : 0.0;

  vec3 p;
  // an ebony key is narrower at the top and its top front edge is set back (a sloping front)
  p.x = aKey.x + lp.x * w * (1.0 - black * topk * 0.3);
  p.y = -len * 0.5 + lp.y * len + black * topk * front * 0.1 * len;
  p.z = -depth * 0.5 + lp.z * depth + black * 0.25;
  p.z -= press * (0.1 + 0.2 * (0.5 - lp.y)) * mix(1.0, 1.3, black);   // pivots about the back: the front goes down more

  vec3 n = normal;
  n.z += black * (abs(n.x) * 0.14 + step(n.y, -0.5) * 0.5);   // the sloped sides and front face a little upward
  vNormal = normalize(n);

  vec3 voiceCol = uVoice[int(clamp(aState.x - 1.0, 0.0, 4.0) + 0.5)];
  float has = step(0.5, aState.x) * uVoiceShow[int(clamp(aState.x - 1.0, 0.0, 4.0) + 0.5)];
  vec3 base = mix(uWhite, uBlack, black);
  vCol = mix(base, voiceCol, aState.z * 0.88 * has);
  vFlareCol = voiceCol * aState.w * has;
  vWorld = p;
  vLocal = lp;
  vBlack = black;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const KEY_FRAG = /* glsl */ `
uniform float uKeyAlpha;
varying vec3 vCol;
varying vec3 vNormal;
varying vec3 vFlareCol;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vBlack;

void main() {
  float black = vBlack;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float top = step(0.7, N.z);

  // the edges of the top face are rounded: tilt the normal outward near them, so they catch the light
  float ex = 0.5 - abs(vLocal.x);
  float ef = vLocal.y + 0.5;
  float roundX = (1.0 - smoothstep(0.0, mix(0.07, 0.14, black), ex)) * top;
  float roundF = (1.0 - smoothstep(0.0, mix(0.025, 0.05, black), ef)) * top;
  N = normalize(N + vec3(sign(vLocal.x) * roundX * 0.9, -roundF * 0.9, 0.0));

  vec3 L = normalize(vec3(0.25, -0.45, 0.85));
  float diff = 0.5 + 0.5 * max(dot(N, L), 0.0);

  // a polished surface shows a studio softbox above and behind the keyboard: broad glow plus a sharper core
  vec3 R = reflect(-V, N);
  float soft = smoothstep(0.6, 0.98, dot(R, normalize(vec3(0.0, 0.32, 0.95))));
  float core = pow(max(dot(R, normalize(vec3(0.05, 0.3, 0.95))), 0.0), 70.0);
  float gloss = mix(0.16, 1.0, black);

  vec3 c = vCol * diff;
  // ivory: a little darker toward the back, where the keys go under the fallboard, and in the gaps between the keys
  float backShade = smoothstep(0.2, 0.5, vLocal.y) * top * (1.0 - black);
  c *= 1.0 - 0.2 * backShade;
  c *= mix(0.55, 1.0, clamp(smoothstep(0.0, 0.035, ex) + black, 0.0, 1.0));
  // the finish
  c += vec3(0.9, 0.94, 1.0) * (soft * 0.14 + core * 0.4) * gloss;
  c = min(c, vec3(0.88));   // the keys never reach the bloom threshold by themselves: only lit keys glow
  c += vFlareCol * 0.9;
  gl_FragColor = vec4(c * uKeyAlpha, uKeyAlpha);
}
`;

/** Black piano lacquer: the key slip, the key blocks at either end and the bed under the keys. A pinstripe of gold on the slip. */
export const LACQUER_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const LACQUER_FRAG = /* glsl */ `
uniform float uKeyAlpha;
uniform float uGold;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 R = reflect(-V, N);
  float soft = smoothstep(0.55, 0.98, dot(R, normalize(vec3(0.0, 0.32, 0.95))));
  float core = pow(max(dot(R, normalize(vec3(0.05, 0.3, 0.95))), 0.0), 50.0);
  // a gentle gradient of the room in the finish: lighter toward the top of a surface that faces the viewer
  float room = 0.5 + 0.5 * R.z;
  vec3 c = vec3(0.012, 0.013, 0.018) + vec3(0.9, 0.94, 1.0) * (soft * 0.07 + core * 0.3) + vec3(0.02, 0.022, 0.03) * room;
  // gold line along the top edge of the front face
  float line = uGold * step(0.5, -N.y) * smoothstep(0.02, 0.0, abs(vLocal.z - 0.3));
  c += vec3(0.78, 0.6, 0.28) * 0.5 * line;
  c = min(c, vec3(0.88));
  gl_FragColor = vec4(c * uKeyAlpha, uKeyAlpha);
}
`;

/**
 * Red key felt: the strip of cloth that runs along the back of the keys (under the fallboard) and down the inner faces of
 * the key blocks on a Yamaha or a Steinway. Matte, a deep wine red, with a fibre grain; lit from above so the top face
 * is the brightest. It shares `LACQUER_VERT` and never reaches the bloom threshold.
 */
export const FELT_FRAG = /* glsl */ `
uniform float uKeyAlpha;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vec3 N = normalize(vNormal);
  float up = clamp(N.z, 0.0, 1.0);
  // fibres: two incommensurate stripes along the length of the strip
  float grain = 0.5 + 0.5 * sin(dot(vWorld.xy, vec2(41.0, 57.0))) * sin(dot(vWorld.xy, vec2(-23.0, 67.0)));
  vec3 red = vec3(0.50, 0.035, 0.06);
  vec3 c = red * (0.55 + 0.6 * up + 0.12 * (1.0 - up) * clamp(-N.y, 0.0, 1.0)) * (0.88 + 0.2 * grain);
  // the edge of a cloth strip catches the light a little
  c += vec3(0.18, 0.03, 0.04) * up * smoothstep(0.35, 0.5, abs(vLocal.y));
  c = min(c, vec3(0.8));
  gl_FragColor = vec4(c * uKeyAlpha, uKeyAlpha);
}
`;

/**
 * The road (T6.4.1), after the lanes of SkyRoads: faint lines between the keys' lanes (stronger at every C, the octaves),
 * a line across the road at the start of every bar, and under each sounding key a lane of light in its voice's colour
 * that thins away up the road. All of it fades toward the far end so the notes seem to come from a horizon. It is
 * drawn with the notes' premultiplied blend (alpha 0: an additive glow) and only in the keyboard layout.
 *
 * Care with NaN: the bloom works in a half-float target, where one NaN pixel (a `pow` of a slightly negative number at a
 * quad's edge, a `smoothstep` with equal edges) is spread by the blur over the whole frame and blacks it out. So every
 * `pow` has a clamped base, every anti-aliasing width a floor, and the output is forced to a finite number.
 */
export const ROAD_VERT = /* glsl */ `
uniform float uRoadLen;
varying vec2 vW;
void main() {
  // a unit quad stretched over the keyboard's width and the road's length, in world units
  vec3 p = vec3(position.x * 53.0, (position.y + 0.5) * uRoadLen, -0.006);
  vW = p.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const ROAD_FRAG = /* glsl */ `
uniform float uRoad;       // strength: scene setting x ending x layout
uniform float uRoadLen;    // length of the road in world units
uniform float uBars[16];   // distance of each coming bar line from the hit line, world units (far negative: unused)
varying vec2 vW;

void main() {
  float y = vW.y;
  float k = clamp(y / uRoadLen, 0.0, 1.0);
  float fade = pow(max(1.0 - k, 0.0), 1.5) * smoothstep(0.0, 0.5, y + 0.4);

  // lines between white keys; a stronger one on the left edge of every C
  float fx = vW.x + 26.0;
  float idx = floor(fx + 0.5);
  float dx = abs(fx - idx);
  float aax = max(fwidth(fx), 1e-4);
  float lane = 1.0 - smoothstep(0.008, 0.008 + aax * 1.3, dx);
  float octave = 1.0 - step(0.5, abs(mod(idx - 2.0 + 700.0, 7.0)));
  float lines = lane * mix(0.05, 0.22, octave) * step(0.0, idx) * step(idx, 52.0);

  // a line across the road at each bar, with a soft glow either side
  float bar = 0.0;
  float aay = max(fwidth(y), 1e-4);
  for (int i = 0; i < 16; i++) {
    float d = abs(y - uBars[i]);
    bar = max(bar, (1.0 - smoothstep(0.02, 0.02 + aay * 1.3, d)) * 0.55 + exp(-min(d, 50.0) * 7.0) * 0.16);
  }

  float edge = smoothstep(0.0, 1.5, fx) * smoothstep(0.0, 1.5, 52.0 - fx);
  float a = (lines + bar * edge) * fade * uRoad;
  a = a > 0.0 ? min(a, 1.0) : 0.0;   // never NaN or negative
  gl_FragColor = vec4(vec3(0.62, 0.72, 1.0) * a, 0.0);
}
`;

/** Lanes of light above the pressed keys: one quad per key, from the same key table and key state as the keys. */
export const LANE_VERT = /* glsl */ `
attribute vec4 aKey;    // x, isBlack, width, -
attribute vec4 aState;  // voice, press, glow, flare
uniform vec3 uVoice[5];
uniform float uVoiceShow[5];
uniform float uRoadLen;
uniform float uRoad;
varying vec3 vCol;
varying vec2 vUV;
varying float vInt;

void main() {
  float black = aKey.y;
  float len = uRoadLen * mix(0.5, 0.34, black);
  vUV = position.xy + 0.5;
  vec3 p = vec3(aKey.x + position.x * aKey.z, vUV.y * len, -0.004);
  vCol = uVoice[int(clamp(aState.x - 1.0, 0.0, 4.0) + 0.5)];
  float has = step(0.5, aState.x) * uVoiceShow[int(clamp(aState.x - 1.0, 0.0, 4.0) + 0.5)];
  vInt = has * (aState.y * aState.z * 0.8 + aState.w * 0.5) * mix(1.0, 0.8, black) * uRoad;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const LANE_FRAG = /* glsl */ `
varying vec3 vCol;
varying vec2 vUV;
varying float vInt;
void main() {
  float across = 1.0 - smoothstep(0.25, 0.5, abs(vUV.x - 0.5));
  float up = pow(clamp(1.0 - vUV.y, 0.0, 1.0), 2.2);   // the base of pow must not go negative (NaN)
  float a = vInt * across * up * 0.34;
  a = a > 0.0 ? min(a, 1.0) : 0.0;
  gl_FragColor = vec4(vCol * a, 0.0);
}
`;

/** Particle bursts: position is a function of age, computed here (T4.3.1). */
export const PARTICLE_VERT = /* glsl */ `
${COMMON}
attribute vec4 aA;  // x, birth, life, kind (0 spark, 1 ember)
attribute vec4 aB;  // voice, pitch, random, size
uniform float uPointScale;
uniform float uParticles;

varying vec3 vColor;
varying float vAlpha;

void main() {
  float age = uTime - aA.y;
  float life = aA.z;
  if (uParticles <= 0.001 || age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float k = age / life;
  float spark = 1.0 - aA.w;
  float r = aB.z;
  float r2 = fract(r * 7.31 + 0.123);
  float ang = (r * 2.0 - 1.0) * mix(0.55, 0.9, spark);
  float spd = mix(0.5 + 1.0 * r2, 3.0 + 4.0 * r2, spark);
  float g = mix(0.8, -8.5, spark);
  vec2 d = vec2(sin(ang), cos(ang)) * spd * age + vec2(0.0, 0.5 * g * age * age);
  d.x += (1.0 - spark) * sin(age * 3.0 + r * 20.0) * 0.18 * min(age, 1.0);

  vec3 origin = place(aA.x, 0.0, 0.0, aB.x, aB.y);
  vec3 dk = vec3(d.x, d.y, 0.25);
  vec3 dl = vec3(d.y * 0.8, d.x * 0.8, 0.25);
  vec4 mv = viewMatrix * vec4(origin + (uMix >= 0.5 ? dl : dk), 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, aB.w * uPointScale / -mv.z * (1.0 - 0.6 * k));

  vColor = uVoice[voiceIndex(aB.x)] * (1.0 + 0.6 * (1.0 - k));
  vAlpha = uParticles * pow(1.0 - k, 1.5) * mix(0.55, 1.0, spark) * layoutAlpha() * uDim * voiceShow(aB.x);
}
`;

export const PARTICLE_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a *= a;
  gl_FragColor = vec4(vColor * a * vAlpha, 0.0);
}
`;

/** A ring that spreads from the pitch and time of a clash or crossing (T5.4.2). */
export const SHOCK_VERT = /* glsl */ `
${COMMON}
attribute vec4 aS;   // x, birth, strength, voice
attribute vec4 aS2;  // pitch, kind (0 clash, 1 crossing), -, -
uniform float uShocks;
varying vec2 vP;
varying vec4 vInfo;  // progress, strength, kind, radius

const float LIFE = 1.1;

void main() {
  float age = uTime - aS.y;
  if (uShocks <= 0.001 || age < 0.0 || age > LIFE) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float k = age / LIFE;
  float R = (0.5 + 3.4 * (1.0 - pow(1.0 - k, 2.0))) * (0.7 + 0.3 * aS.z);
  float ext = R + 0.8;
  vec3 c = place(aS.x, 0.0, 0.0, aS.w, aS2.x);
  vP = position.xy * 2.0 * ext;
  vInfo = vec4(k, aS.z * uShocks * layoutAlpha() * uDim, aS2.y, R);
  gl_Position = projectionMatrix * viewMatrix * vec4(c + vec3(vP, 0.35), 1.0);
}
`;

export const SHOCK_FRAG = /* glsl */ `
varying vec2 vP;
varying vec4 vInfo;
void main() {
  float k = vInfo.x;
  float w = 0.1 + 0.28 * k;
  float x = (length(vP) - vInfo.w) / w;
  float ring = exp(-x * x);
  vec3 col = mix(vec3(1.0, 0.78, 0.5), vec3(0.55, 0.85, 1.0), vInfo.z); // a clash is warm, a crossing cool
  float a = ring * pow(1.0 - k, 1.6) * vInfo.y * 0.8;
  gl_FragColor = vec4(col * a, 0.0);
}
`;

/** A thread from the place where a canon's leader note sounded to where its follower will echo it (T5.6.1). */
export const LINK_VERT = /* glsl */ `
${COMMON}
attribute vec4 aL0;  // leader: x, voice, pitch, t_on
attribute vec4 aL1;  // follower: x, voice, pitch, t_on
uniform float uAhead;
uniform float uLinks;
varying vec3 vColor;
varying vec2 vV;     // 0..1 from leader end to follower end, -1..1 across

void main() {
  float tn = noteTime();
  float rem = aL1.w - tn;
  if (uLinks <= 0.001 || rem <= 0.0 || rem > uAhead || aL0.w > tn) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 p0 = place(aL0.x, 0.0, 0.0, aL0.y, aL0.z);
  vec3 p1 = place(aL1.x, rem * uSpeed, 0.0, aL1.y, aL1.z);
  vec2 d = p1.xy - p0.xy;
  vec2 dir = d / (length(d) + 1e-4);
  float v = position.y + 0.5;
  float u = position.x * 2.0;
  vec3 p = mix(p0, p1, v) + vec3(vec2(-dir.y, dir.x) * u * 0.035, 0.2);
  vColor = mix(uVoice[voiceIndex(aL0.y)], uVoice[voiceIndex(aL1.y)], v);
  float near = 1.0 - rem / uAhead;                               // the thread brightens as the echo approaches
  vV = vec2(v, u);
  vColor *= uLinks * (0.05 + 0.7 * near * near * near) * layoutAlpha() * uDim;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const LINK_FRAG = /* glsl */ `
varying vec3 vColor;
varying vec2 vV;
void main() {
  float edge = 1.0 - abs(vV.y);
  gl_FragColor = vec4(vColor * edge * (0.35 + 0.65 * vV.x), 0.0);
}
`;
