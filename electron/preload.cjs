const {
  contextBridge,
  ipcRenderer,
  webUtils,
  sharedTexture,
} = require("electron");
let gpuResources;
async function prepareGpuPreview() {
  if (gpuResources) return { available: true };
  if (!navigator.gpu || !sharedTexture)
    throw new Error("WebGPU 或 Electron 共享纹理接口不可用");
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw new Error("没有可用的 WebGPU 适配器");
  const device = await adapter.requestDevice();
  const shader = device.createShaderModule({
    code: `
    @group(0) @binding(0) var frameSampler: sampler;
    @group(0) @binding(1) var frameTexture: texture_external;
    struct Output { @builtin(position) position: vec4f, @location(0) uv: vec2f }
    @vertex fn vertexMain(@builtin(vertex_index) i:u32)->Output {
      let positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
      var output:Output;output.position=vec4f(positions[i],0,1);output.uv=vec2f((positions[i].x+1)*0.5,1-(positions[i].y+1)*0.5);return output;
    }
    @fragment fn fragmentMain(input:Output)->@location(0) vec4f {return textureSampleBaseClampToEdge(frameTexture,frameSampler,input.uv);}
  `,
  });
  const format = navigator.gpu.getPreferredCanvasFormat();
  const pipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: { module: shader, entryPoint: "vertexMain" },
    fragment: {
      module: shader,
      entryPoint: "fragmentMain",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });
  gpuResources = {
    device,
    pipeline,
    format,
    sampler: device.createSampler({ magFilter: "linear", minFilter: "linear" }),
  };
  device.lost.then(() => {
    gpuResources = undefined;
  });
  return {
    available: true,
    adapter: adapter.info?.description || adapter.info?.vendor || "WebGPU",
  };
}
sharedTexture?.setSharedTextureReceiver(
  async ({ importedSharedTexture }, metadata) => {
    let frame;
    try {
      const canvas = document.getElementById("native-gpu-preview");
      if (!canvas || !gpuResources) return;
      frame = importedSharedTexture.getVideoFrame();
      const { device, pipeline, format, sampler } = gpuResources;
      canvas.width = frame.codedWidth;
      canvas.height = frame.codedHeight;
      const context = canvas.getContext("webgpu");
      context.configure({ device, format, alphaMode: "opaque" });
      const external = device.importExternalTexture({ source: frame });
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: external },
        ],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      ipcRenderer.send("host:gpu-presented", metadata);
    } finally {
      frame?.close();
      importedSharedTexture.release();
    }
  },
);
contextBridge.exposeInMainWorld("workstation", {
  prepareGpuPreview,
  onGpuStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("host:gpu-status", listener);
    return () => ipcRenderer.removeListener("host:gpu-status", listener);
  },
  request: (method, params = {}) =>
    ipcRenderer.invoke("host:request", { method, params }),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("host:changed", listener);
    return () => ipcRenderer.removeListener("host:changed", listener);
  },
});
