export interface HealthPayload {
  service: "mdcz-server";
  status: "ok";
  slice: "app-skeleton";
}

export const createHealthPayload = (): HealthPayload => ({
  service: "mdcz-server",
  status: "ok",
  slice: "app-skeleton",
});
