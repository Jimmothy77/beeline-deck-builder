export {};

declare global {
  interface Window {
    PRINTABEE_CONFIG?: {
      googleApiKey?: string;
    };
  }
}
