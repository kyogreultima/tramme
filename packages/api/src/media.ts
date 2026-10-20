// Optional media routing through Hydracept (MEDIA_PROVIDER=hydracept on the Worker).

export interface HydraceptMedia {
  apiKey: string;
  apiUrl: string;
  productId: string;
  projectId: string;
  environment: string;
  billingMode?: string;
}

export interface MediaConfig {
  provider: 'hydracept';
  hydracept: HydraceptMedia;
}

/** env vars the Worker (or tests) may set; HYDRACEPT_API_KEY is never echoed back */
export function mediaConfig(env: {
  MEDIA_PROVIDER?: string;
  HYDRACEPT_API_KEY?: string;
  HYDRACEPT_API_URL?: string;
  HYDRACEPT_PROJECT?: string;
  HYDRACEPT_PRODUCT_ID?: string;
  HYDRACEPT_ENVIRONMENT?: string;
  HYDRACEPT_BILLING_MODE?: string;
}): MediaConfig | undefined {
  if (env.MEDIA_PROVIDER !== 'hydracept') return undefined;
  const apiKey = env.HYDRACEPT_API_KEY?.trim();
  const projectId = env.HYDRACEPT_PROJECT?.trim();
  if (!apiKey || !projectId) return undefined;
  const apiUrl = (env.HYDRACEPT_API_URL?.trim() || 'https://api.hydracept.com').replace(/\/+$/, '');
  const productId = env.HYDRACEPT_PRODUCT_ID?.trim() || 'tramme';
  const environment = env.HYDRACEPT_ENVIRONMENT?.trim() || 'development';
  const billingMode = env.HYDRACEPT_BILLING_MODE?.trim();
  return {
    provider: 'hydracept',
    hydracept: { apiKey, apiUrl, productId, projectId, environment, ...(billingMode ? { billingMode } : {}) },
  };
}

/** what /api/config may say about Hydracept (no secrets) */
export function mediaStatus(media: MediaConfig | undefined): { provider: 'hydracept' } | undefined {
  return media?.provider === 'hydracept' ? { provider: 'hydracept' } : undefined;
}
