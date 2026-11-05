import { createApiClient } from "../../src/client/apiClient";
import { createEventTracker } from "../../src/client/eventTracker";
import { createReadingFlow } from "../../src/client/readingFlow";
import { getIdToken } from "./auth";

export const api = createApiClient({ getIdToken });
export const events = createEventTracker({ api, appVersion: __APP_VERSION__ });
export const flow = createReadingFlow(api, events);
