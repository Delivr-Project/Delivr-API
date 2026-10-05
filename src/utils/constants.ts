export namespace AppConstants {
	export const APP_NAME = "Delivr-API";

	export const APP_ENV_PREFIX = "DLA";

	export const APP_KEYS_PREFIX = "dla";

	export const APP_API_DEFAULT_PORT = 14123;

	export const APP_API_DEFAULT_PROD_URL = `https://api.${AppConstants.APP_NAME.toLowerCase()}.is-on.net`;

	export const DEFAULT_EMAIL_FROM_HOST = "appname.local";

	export const DEFAULT_SMTP_FROM = `\"${AppConstants.APP_NAME}\" <noreply@${AppConstants.DEFAULT_EMAIL_FROM_HOST}>`;

	export const BINARY_NAME = "delivr-api";
}
