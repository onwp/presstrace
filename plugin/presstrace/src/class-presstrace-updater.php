<?php
/**
 * Plugin updates from GitHub releases.
 *
 * The plugin header sets "Update URI: https://github.com/onwp/presstrace", so WordPress never matches
 * PressTrace against a WordPress.org plugin with the same slug and instead asks the
 * update_plugins_github.com filter. This class answers that filter with the latest published (non
 * prerelease) GitHub release, when it ships a presstrace-<version>.zip asset.
 *
 * Define PRESSTRACE_DISABLE_UPDATE_CHECK as true in wp-config.php to turn the check off.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

/**
 * Answers WordPress update checks for PressTrace from the GitHub releases API.
 */
class PressTrace_Updater {

	const UPDATE_URI  = 'https://github.com/onwp/presstrace';
	const RELEASE_API = 'https://api.github.com/repos/onwp/presstrace/releases/latest';
	const CACHE_KEY   = 'presstrace_latest_release';
	const CACHE_TTL   = 43200; // 12 hours.
	const ERROR_TTL   = 3600;  // Retry a failed lookup after an hour.

	/**
	 * Registers the update filter.
	 */
	public static function init() {
		if ( defined( 'PRESSTRACE_DISABLE_UPDATE_CHECK' ) && PRESSTRACE_DISABLE_UPDATE_CHECK ) {
			return;
		}
		add_filter( 'update_plugins_github.com', array( __CLASS__, 'check' ), 10, 3 );
	}

	/**
	 * Filter callback for update_plugins_github.com.
	 *
	 * @param array|false $update      Update data from an earlier callback, or false.
	 * @param array       $plugin_data Plugin header data.
	 * @param string      $plugin_file Plugin path relative to the plugins directory.
	 * @return array|false
	 */
	public static function check( $update, $plugin_data, $plugin_file ) {
		if ( false !== $update ) {
			return $update;
		}
		if ( ! is_array( $plugin_data ) || ! isset( $plugin_data['UpdateURI'] ) || self::UPDATE_URI !== untrailingslashit( $plugin_data['UpdateURI'] ) ) {
			return $update;
		}

		$latest = self::latest_update();
		if ( null === $latest ) {
			return $update;
		}
		$latest['slug'] = dirname( (string) $plugin_file );
		return $latest;
	}

	/**
	 * Turns a GitHub release object into the array WordPress expects, or null when the release has no
	 * usable version or plugin zip.
	 *
	 * @param array $release Decoded JSON of a GitHub release.
	 * @return array|null
	 */
	public static function parse_release( array $release ) {
		if ( ! empty( $release['draft'] ) || ! empty( $release['prerelease'] ) ) {
			return null;
		}
		$tag     = isset( $release['tag_name'] ) ? (string) $release['tag_name'] : '';
		$version = ltrim( $tag, 'vV' );
		if ( ! preg_match( '/^\d+\.\d+\.\d+$/', $version ) ) {
			return null;
		}

		$expected = 'presstrace-' . $version . '.zip';
		$package  = '';
		$assets   = isset( $release['assets'] ) && is_array( $release['assets'] ) ? $release['assets'] : array();
		foreach ( $assets as $asset ) {
			if ( is_array( $asset ) && isset( $asset['name'], $asset['browser_download_url'] ) && $expected === $asset['name'] ) {
				$package = (string) $asset['browser_download_url'];
				break;
			}
		}
		if ( 0 !== strpos( $package, 'https://github.com/onwp/presstrace/releases/download/' ) ) {
			return null;
		}

		return array(
			'id'      => self::UPDATE_URI,
			'version' => $version,
			'url'     => isset( $release['html_url'] ) ? (string) $release['html_url'] : self::UPDATE_URI . '/releases',
			'package' => $package,
		);
	}

	/**
	 * Returns the parsed latest release from the cache or the GitHub API, or null when there is none.
	 *
	 * @return array|null
	 */
	private static function latest_update() {
		$cached = get_site_transient( self::CACHE_KEY );
		if ( is_array( $cached ) ) {
			return empty( $cached ) ? null : $cached;
		}

		$response = wp_remote_get(
			self::RELEASE_API,
			array(
				'timeout' => 5,
				'headers' => array( 'Accept' => 'application/vnd.github+json' ),
			)
		);
		$latest   = null;
		if ( ! is_wp_error( $response ) && 200 === (int) wp_remote_retrieve_response_code( $response ) ) {
			$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
			if ( is_array( $body ) ) {
				$latest = self::parse_release( $body );
			}
		}

		// An empty array marks a failed lookup so it is not retried on every update check.
		set_site_transient( self::CACHE_KEY, null === $latest ? array() : $latest, null === $latest ? self::ERROR_TTL : self::CACHE_TTL );
		return $latest;
	}
}
