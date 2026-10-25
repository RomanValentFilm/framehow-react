// THE VIEWFINDER ON THE GRAPHICS CHIP (25 October, Roman: "the FH CAM stutters
// now" — 16 fps on the iPhone with the 4K stream). Running the curve on the
// main processor means copying every 4K frame out of the video first; that
// copy alone is more than a frame's budget. Here the video is handed to the
// graphics chip as a texture and the curve is applied by a tiny shader: the
// SAME 256-value table and the same colour factor as the shot, so what you
// see is still what lands on the card. Nothing is copied back.
//
// Returns null where WebGL is not available; the caller then paints the old
// way. Kept small on purpose.

export type GpuViewfinder = {
  canvas: HTMLCanvasElement;
  setLUT(lut: Uint8Array, sat: number): void;
  draw(video: HTMLVideoElement, w: number, h: number): boolean;
  dispose(): void;
};

export function makeGpuViewfinder(): GpuViewfinder | null {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const vs = `attribute vec2 p; varying vec2 t; void main(){ t = vec2(p.x*0.5+0.5, 0.5-p.y*0.5); gl_Position = vec4(p,0.0,1.0); }`;
  const fs = `precision mediump float; varying vec2 t; uniform sampler2D v; uniform sampler2D l; uniform float s;
    void main(){ vec3 c = texture2D(v, t).rgb;
      // the table: 256 entries along x, one row — same lookup as the shot
      vec3 m = vec3(texture2D(l, vec2((c.r*255.0+0.5)/256.0, 0.5)).r,
                    texture2D(l, vec2((c.g*255.0+0.5)/256.0, 0.5)).r,
                    texture2D(l, vec2((c.b*255.0+0.5)/256.0, 0.5)).r);
      float g = dot(m, vec3(0.299, 0.587, 0.114));
      gl_FragColor = vec4(g + (m - g) * s, 1.0); }`;
  const sh = (type: number, src: string) => { const o = gl.createShader(type)!; gl.shaderSource(o, src); gl.compileShader(o); return o; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const p = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
  const mkTex = (unit: number) => { const t = gl.createTexture()!; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  const vidTex = mkTex(0); const lutTex = mkTex(1);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lutTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.uniform1i(gl.getUniformLocation(prog, 'v'), 0); gl.uniform1i(gl.getUniformLocation(prog, 'l'), 1);
  const sLoc = gl.getUniformLocation(prog, 's');
  let lost = false;
  canvas.addEventListener('webglcontextlost', () => { lost = true; });
  return {
    canvas,
    setLUT(lut, sat) {
      if (lost) return;
      const px = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) { px[i * 4] = lut[i]; px[i * 4 + 1] = lut[i]; px[i * 4 + 2] = lut[i]; px[i * 4 + 3] = 255; }
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lutTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.uniform1f(sLoc, sat);
    },
    draw(video, w, h) {
      if (lost) return false;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, vidTex);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); } catch { return false; }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    },
    dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}
