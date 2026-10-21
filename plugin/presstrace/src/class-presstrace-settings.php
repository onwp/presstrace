<?php
/**
 * Settings: defaults, constant overrides, sanitisation and the monitoring window.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Settings', false ) ) {
	return;
}

/**
 * Settings stored in the single autoloaded option "presstrace_settings".
 */
final class PressTrace_Settings {

	/**
	 * Option name.
	 */
	const OPTION = 'presstrace_settings';

	/**
	 * Monitoring windows in hours. "always" has no expiry.
	 *
	 * @var array<string, int>
	 */
	const WINDOWS = array(
		'2h'     => 2,
		'4h'     => 4,
		'12h'    => 12,
		'24h'    => 24,
		'always' => 0,
	);

	/**
	 * Returns the default settings.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'app_url'       => '',
			'site_key'      => '',
			'enabled'       => false,
			'window'        => '2h',
			'enabled_until' => 0,
			'sample_rate'   => 1.0,
		);
	}

	/**
	 * Returns the stored settings merged with defaults, without constant overrides.
	 *
	 * @return array
	 */
	public static function stored() {
		$value    = get_option( self::OPTION, array() );
		$settings = array_merge( self::defaults(), is_array( $value ) ? $value : array() );
		// Values written outside the settings screen (WP-CLI, code) may be strings such as "false".
		$settings['enabled'] = filter_var( $settings['enabled'], FILTER_VALIDATE_BOOLEAN );
		return $settings;
	}

	/**
	 * Returns the effective settings: stored values with PRESSTRACE_* constants applied.
	 *
	 * @return array
	 */
	public static function get() {
		return self::apply_constants( self::stored(), self::constants() );
	}

	/**
	 * Reads the override constants that are defined.
	 *
	 * @return array<string, mixed>
	 */
	public static function constants() {
		$out = array();
		if ( defined( 'PRESSTRACE_APP_URL' ) ) {
			$out['app_url'] = constant( 'PRESSTRACE_APP_URL' );
		}
		if ( defined( 'PRESSTRACE_SITE_KEY' ) ) {
			$out['site_key'] = constant( 'PRESSTRACE_SITE_KEY' );
		}
		if ( defined( 'PRESSTRACE_SAMPLE_RATE' ) ) {
			$out['sample_rate'] = constant( 'PRESSTRACE_SAMPLE_RATE' );
		}
		if ( defined( 'PRESSTRACE_ALWAYS_ON' ) ) {
			$out['always_on'] = (bool) constant( 'PRESSTRACE_ALWAYS_ON' );
		}
		return $out;
	}

	/**
	 * Applies constant overrides to settings.
	 *
	 * @param array $settings  Settings.
	 * @param array $constants Output of constants().
	 * @return array
	 */
	public static function apply_constants( array $settings, array $constants ) {
		if ( isset( $constants['app_url'] ) ) {
			$settings['app_url'] = self::clean_app_url( $constants['app_url'] );
		}
		if ( isset( $constants['site_key'] ) ) {
			$settings['site_key'] = self::clean_site_key( $constants['site_key'] );
		}
		if ( isset( $constants['sample_rate'] ) ) {
			$settings['sample_rate'] = self::clean_sample_rate( $constants['sample_rate'] );
		}
		if ( ! empty( $constants['always_on'] ) ) {
			$settings['enabled']       = true;
			$settings['window']        = 'always';
			$settings['enabled_until'] = 0;
		}
		return $settings;
	}

	/**
	 * Sanitises submitted settings.
	 *
	 * An empty site key keeps the previous key (the field is never pre-filled). When monitoring is on,
	 * every save restarts the window from $now.
	 *
	 * @param mixed $input    Submitted values.
	 * @param array $previous Previously stored settings.
	 * @param int   $now      Current Unix time.
	 * @return array
	 */
	public static function sanitize( $input, array $previous, $now ) {
		$input    = is_array( $input ) ? $input : array();
		$previous = array_merge( self::defaults(), $previous );
		$out      = $previous;

		if ( array_key_exists( 'app_url', $input ) ) {
			$out['app_url'] = self::clean_app_url( $input['app_url'] );
		}

		if ( array_key_exists( 'site_key', $input ) ) {
			$key = self::clean_site_key( $input['site_key'] );
			if ( '' !== $key ) {
				$out['site_key'] = $key;
			}
		}

		if ( array_key_exists( 'sample_rate', $input ) ) {
			$out['sample_rate'] = self::clean_sample_rate( $input['sample_rate'] );
		}

		if ( array_key_exists( 'window', $input ) ) {
			$window        = is_string( $input['window'] ) ? $input['window'] : '';
			$out['window'] = array_key_exists( $window, self::WINDOWS ) ? $window : '2h';
		}

		$out['enabled'] = ! empty( $input['enabled'] );

		if ( $out['enabled'] ) {
			$hours                = self::WINDOWS[ $out['window'] ];
			$out['enabled_until'] = 0 === $hours ? 0 : (int) $now + $hours * 3600;
		} else {
			$out['enabled_until'] = 0;
		}

		return array(
			'app_url'       => (string) $out['app_url'],
			'site_key'      => (string) $out['site_key'],
			'enabled'       => (bool) $out['enabled'],
			'window'        => (string) $out['window'],
			'enabled_until' => (int) $out['enabled_until'],
			'sample_rate'   => (float) $out['sample_rate'],
		);
	}

	/**
	 * Validates an app URL: http or https, no query, no trailing slash.
	 *
	 * @param mixed $url Raw URL.
	 * @return string Clean URL or an empty string when invalid.
	 */
	public static function clean_app_url( $url ) {
		if ( ! is_string( $url ) ) {
			return '';
		}
		$url = trim( $url );
		if ( '' === $url || preg_match( '/[\s<>"\']/', $url ) ) {
			return '';
		}
		$parts = parse_url( $url ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url -- pure helper.
		if ( false === $parts || empty( $parts['host'] ) || empty( $parts['scheme'] ) ) {
			return '';
		}
		$scheme = strtolower( $parts['scheme'] );
		if ( 'http' !== $scheme && 'https' !== $scheme ) {
			return '';
		}
		if ( isset( $parts['user'] ) || isset( $parts['pass'] ) ) {
			return '';
		}
		$out = $scheme . '://' . strtolower( $parts['host'] );
		if ( isset( $parts['port'] ) ) {
			$out .= ':' . (int) $parts['port'];
		}
		if ( isset( $parts['path'] ) ) {
			$out .= rtrim( $parts['path'], '/' );
		}
		return $out;
	}

	/**
	 * Validates a site key: "pt_" followed by 40 hex characters.
	 *
	 * @param mixed $key Raw key.
	 * @return string Clean key or an empty string when invalid.
	 */
	public static function clean_site_key( $key ) {
		if ( ! is_string( $key ) ) {
			return '';
		}
		$key = strtolower( trim( $key ) );
		return preg_match( '/^pt_[0-9a-f]{40}$/', $key ) ? $key : '';
	}

	/**
	 * Clamps a sample rate to 0..1.
	 *
	 * @param mixed $rate Raw rate.
	 * @return float
	 */
	public static function clean_sample_rate( $rate ) {
		if ( is_string( $rate ) ) {
			$rate = str_replace( ',', '.', trim( $rate ) );
		}
		if ( ! is_numeric( $rate ) ) {
			return 1.0;
		}
		$rate = (float) $rate;
		if ( $rate < 0 ) {
			return 0.0;
		}
		if ( $rate > 1 ) {
			return 1.0;
		}
		return round( $rate, 4 );
	}

	/**
	 * Returns true when app URL and site key are present.
	 *
	 * @param array $settings Effective settings.
	 * @return bool
	 */
	public static function is_configured( array $settings ) {
		return '' !== $settings['app_url'] && '' !== $settings['site_key'];
	}

	/**
	 * Returns true when monitoring is enabled and inside its window.
	 *
	 * @param array $settings Effective settings.
	 * @param int   $now      Current Unix time.
	 * @return bool
	 */
	public static function is_monitoring( array $settings, $now ) {
		if ( empty( $settings['enabled'] ) ) {
			return false;
		}
		if ( 'always' === $settings['window'] ) {
			return true;
		}
		return (int) $settings['enabled_until'] > (int) $now;
	}

	/**
	 * Decides whether a request is sampled.
	 *
	 * @param float $rate   Sample rate 0..1.
	 * @param float $random Uniform random number in [0, 1).
	 * @return bool
	 */
	public static function is_sampled( $rate, $random ) {
		if ( $rate >= 1.0 ) {
			return true;
		}
		if ( $rate <= 0.0 ) {
			return false;
		}
		return $random < $rate;
	}

	/**
	 * Masks a site key for display: "pt_" plus the last four characters.
	 *
	 * @param string $key Site key.
	 * @return string
	 */
	public static function mask_key( $key ) {
		$key = (string) $key;
		if ( '' === $key ) {
			return '';
		}
		return 'pt_' . str_repeat( '*', 8 ) . substr( $key, -4 );
	}
}
