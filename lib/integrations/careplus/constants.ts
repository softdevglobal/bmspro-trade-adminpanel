export const CAREPLUS_INTEGRATIONS_COLLECTION = "careplus_integrations";
export const CAREPLUS_STAFF_MAPPINGS_COLLECTION = "careplus_staff_mappings";
export const CAREPLUS_CUSTOMER_MAPPINGS_COLLECTION =
  "careplus_customer_mappings";
export const CAREPLUS_OUTBOX_COLLECTION = "careplus_outbox";

export const CAREPLUS_LEARNING_CANONICAL_PATH =
  "/api/integrations/bms/learning";
export const CAREPLUS_DEFAULT_LEARNING_ENDPOINT =
  "https://careplus.bmspros.com.au/api/integrations/bms/learning";
export const CAREPLUS_DEFAULT_EVENTS_ENDPOINT =
  "https://careplus.bmspros.com.au/api/v1/integrations/bms";
export const CAREPLUS_DEFAULT_RECORDS_ENDPOINT =
  "https://careplus.bmspros.com.au/api/v1/integrations/bms/records";
export const CAREPLUS_DEFAULT_DIRECTORY_LIST_ENDPOINT =
  "https://careplus.bmspros.com.au/api/integrations/bms/directory";

export const CAREPLUS_LEARNING_PREFIX = "careplus-bms-learning:v1";
export const CAREPLUS_BMS_DIRECTORY_CANONICAL_PATH =
  "/api/integrations/bms/directory";
export const CAREPLUS_BMS_DIRECTORY_PREFIX = "careplus-bms-directory:v1";
export const CAREPLUS_DIRECTORY_CANONICAL_PATH =
  "/api/integrations/careplus/directory";
export const CAREPLUS_DIRECTORY_PREFIX = "careplus-trade-directory:v1";
export const CAREPLUS_MAX_RESPONSE_BYTES = 256 * 1024;
export const CAREPLUS_REQUEST_TIMEOUT_MS = 15_000;
export const CAREPLUS_OUTBOX_MAX_ATTEMPTS = 8;
export const CAREPLUS_OUTBOX_BATCH_SIZE = 20;

export const CAREPLUS_BACKOFF_SECONDS = [
  60, 300, 900, 3600, 21_600, 43_200, 86_400,
] as const;
