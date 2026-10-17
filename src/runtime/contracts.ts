export interface RuntimeSettings {
  /** Zero means this tenant has not saved settings yet. */
  version: number;
  acceptingOrders: boolean;
  notice: string;
}

export type UpdateRuntimeSettings = RuntimeSettings;
