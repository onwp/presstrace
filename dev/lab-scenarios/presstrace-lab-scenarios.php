<?php
/**
 * Plugin Name: PressTrace Lab Scenarios
 * Description: DEVELOPMENT TOOL. Creates slow and broken behaviour on demand (?pt_scenario=...) so the PressTrace agent and app can be tested. Only active when WP_DEBUG or PRESSTRACE_LAB is defined and true. Never install on a production site.
 * Version: 0.1.0
 * Requires PHP: 7.4
 * Author: PressTrace
 * License: GPL-2.0-or-later
 *
 * Scenarios (combine with commas, for example ?pt_scenario=slow_hook,n_plus_one):
 * slow_hook, n_plus_one, slow_query, slow_external, failed_external, php_warning, fatal, exception, many_queries, select_star, memory.
 * many_queries accepts &pt_queries=N (1 to 2000, default 150). slow_hook accepts &pt_ms=N (1 to 10000, default 300).
 *
 * @package PressTrace_Lab_Scenarios
 */

defined( 'ABSPATH' ) || exit;

if ( ! ( ( defined( 'PRESSTRACE_LAB' ) && PRESSTRACE_LAB ) || ( defined( 'WP_DEBUG' ) && WP_DEBUG ) ) ) {
	return;
}

/**
 * Dev-only scenario runner. Every slow behaviour runs inside this plugin's own callbacks, so the agent
 * attributes it to plugin:presstrace-lab-scenarios.
 */
final class PressTrace_Lab_Scenarios {

	/**
	 * Known scenarios.
	 */
	const SCENARIOS = array( 'slow_hook', 'n_plus_one', 'slow_query', 'slow_external', 'failed_external', 'php_warning', 'fatal', 'exception', 'many_queries', 'select_star', 'memory' );

	/**
	 * Requested scenarios.
	 *
	 * @var string[]
	 */
	private static $requested = array();

	/**
	 * Memory kept alive until the end of the request by the memory scenario.
	 *
	 * @var string[]
	 */
	private static $ballast = array();

	/**
	 * Reads the query parameter and schedules the scenarios.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'admin_notices', array( __CLASS__, 'notice' ) );

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- dev tool, read-only trigger.
		$raw = isset( $_GET['pt_scenario'] ) ? sanitize_text_field( wp_unslash( $_GET['pt_scenario'] ) ) : '';
		if ( '' === $raw ) {
			return;
		}
		self::$requested = array_values( array_intersect( self::SCENARIOS, array_map( 'trim', explode( ',', $raw ) ) ) );
		if ( array() === self::$requested ) {
			return;
		}

		// Front end runs on "wp" (after the main query), admin screens on "admin_init", REST on "rest_api_init".
		add_action( 'wp', array( __CLASS__, 'run' ) );
		add_action( 'admin_init', array( __CLASS__, 'run' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'run' ) );
	}

	/**
	 * Labels admin screens so nobody mistakes the tool for a real plugin.
	 *
	 * @return void
	 */
	public static function notice() {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen || 'plugins' !== $screen->id ) {
			return;
		}
		echo '<div class="notice notice-warning"><p>';
		echo esc_html__( 'PressTrace Lab Scenarios is active. It is a development tool that slows down and breaks requests on purpose when ?pt_scenario= is used. Deactivate it outside the lab.', 'presstrace-lab-scenarios' );
		echo '</p></div>';
	}

	/**
	 * Runs each requested scenario once.
	 *
	 * @return void
	 */
	public static function run() {
		static $done = false;
		if ( $done ) {
			return;
		}
		$done = true;

		foreach ( self::$requested as $scenario ) {
			call_user_func( array( __CLASS__, 'scenario_' . $scenario ) );
		}
	}

	/**
	 * A plugin callback that blocks for 300 ms (?pt_ms=N to change, for example 3200 for a high severity slow transaction).
	 *
	 * @return void
	 */
	public static function scenario_slow_hook() {
		add_action( 'wp_footer', array( __CLASS__, 'slow_footer_callback' ) );
		add_action( 'admin_footer', array( __CLASS__, 'slow_footer_callback' ) );
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- dev tool.
		$ms = isset( $_GET['pt_ms'] ) ? max( 1, min( 10000, absint( $_GET['pt_ms'] ) ) ) : 300;
		usleep( $ms * 1000 );
	}

	/**
	 * Second slow callback on a later hook, to show nested hook timing.
	 *
	 * @return void
	 */
	public static function slow_footer_callback() {
		usleep( 120000 );
	}

	/**
	 * Same query shape 30 times with the meta cache cleared each time.
	 *
	 * @return void
	 */
	public static function scenario_n_plus_one() {
		global $wpdb;
		$ids = $wpdb->get_col( "SELECT ID FROM {$wpdb->posts} ORDER BY ID ASC LIMIT 30" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$ids = array_map( 'intval', (array) $ids );
		for ( $i = count( $ids ); $i < 30; $i++ ) {
			$ids[] = 1000000 + $i;
		}
		foreach ( $ids as $id ) {
			wp_cache_delete( $id, 'post_meta' );
			get_post_meta( $id, '_presstrace_lab', true );
		}
	}

	/**
	 * A query that takes 300 ms.
	 *
	 * @return void
	 */
	public static function scenario_slow_query() {
		global $wpdb;
		$wpdb->query( 'SELECT SLEEP(0.3)' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	}

	/**
	 * An external call that takes about 800 ms (the PressTrace app's delay endpoint), with a public fallback.
	 * The endpoint only exists when the app runs with ENABLE_DEBUG_ROUTES=1; without it the app answers 404
	 * and the fallback runs instead.
	 *
	 * @return void
	 */
	public static function scenario_slow_external() {
		// The app's delay endpoint needs the site key, so it is read from the PressTrace settings.
		$settings = class_exists( 'PressTrace_Settings' ) ? PressTrace_Settings::get() : array();
		$app_url  = ! empty( $settings['app_url'] ) ? $settings['app_url'] : 'http://host.docker.internal:8080';
		$headers  = ! empty( $settings['site_key'] ) ? array( 'Authorization' => 'Bearer ' . $settings['site_key'] ) : array();
		$response = wp_remote_get(
			$app_url . '/api/v1/debug/delay?ms=800',
			array(
				'timeout' => 3,
				'headers' => $headers,
			)
		);
		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			wp_remote_get( 'https://httpbin.org/delay/1', array( 'timeout' => 5 ) );
		}
	}

	/**
	 * An external call that fails at the transport level: nothing listens on port 9.
	 *
	 * @return void
	 */
	public static function scenario_failed_external() {
		wp_remote_get( 'http://127.0.0.1:9/presstrace-lab', array( 'timeout' => 1 ) );
	}

	/**
	 * A warning, a notice and a deprecation from plugin code.
	 *
	 * @return void
	 */
	public static function scenario_php_warning() {
		$settings = array();
		// Undefined array key: a real engine warning, as plugins produce it.
		$value = $settings['presstrace_lab_missing'];
		unset( $value );
		trigger_error( 'PressTrace lab: user warning from a plugin', E_USER_WARNING ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_trigger_error
		trigger_error( 'PressTrace lab: user notice from a plugin', E_USER_NOTICE ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_trigger_error
		trigger_error( 'PressTrace lab: deprecated call from a plugin', E_USER_DEPRECATED ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_trigger_error
		// The same warning twice: the agent keeps it once.
		trigger_error( 'PressTrace lab: user warning from a plugin', E_USER_WARNING ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_trigger_error
	}

	/**
	 * A fatal error: call to an undefined function.
	 *
	 * @return void
	 */
	public static function scenario_fatal() {
		$function = 'presstrace_lab_function_that_does_not_exist';
		$function();
	}

	/**
	 * An uncaught exception.
	 *
	 * @return void
	 * @throws RuntimeException Always.
	 */
	public static function scenario_exception() {
		throw new RuntimeException( 'PressTrace lab: uncaught exception from a plugin' );
	}

	/**
	 * Many small uncached queries (150 by default, ?pt_queries=N to change).
	 *
	 * @return void
	 */
	public static function scenario_many_queries() {
		global $wpdb;
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- dev tool.
		$count = isset( $_GET['pt_queries'] ) ? max( 1, min( 2000, absint( $_GET['pt_queries'] ) ) ) : 150;
		for ( $i = 0; $i < $count; $i++ ) {
			$wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s LIMIT 1", 'presstrace_lab_' . $i ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		}
	}

	/**
	 * SELECT * from a plugin.
	 *
	 * @return void
	 */
	public static function scenario_select_star() {
		global $wpdb;
		$wpdb->get_results( "SELECT * FROM {$wpdb->posts} LIMIT 20" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	}

	/**
	 * Raises peak memory to about 85% of a 256 MB limit.
	 *
	 * @return void
	 */
	public static function scenario_memory() {
		// phpcs:ignore WordPress.PHP.IniSet.memory_limit_Disallowed -- dev tool.
		ini_set( 'memory_limit', '256M' );
		$target = (int) ( 256 * 1048576 * 0.85 );
		while ( memory_get_usage() < $target - 8 * 1048576 ) {
			self::$ballast[] = str_repeat( 'p', 8 * 1048576 );
		}
	}
}

PressTrace_Lab_Scenarios::init();
