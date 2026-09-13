import { createHost, type DesktopBridge } from "../packages/sdk/src";
declare global {
  interface Window {
    workstation: DesktopBridge;
  }
}
export const desktop = window.workstation;
export const host = createHost(
  desktop ?? {
    request: async () => {
      throw new Error("请通过桌面应用启动：npm run dev");
    },
  },
);
