<?php
/**
 * Loads the agent classes and boots the agent. Required by the loader mu-plugin and, as a fallback,
 * by the main plugin file when the loader is missing.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'PRESSTRACE_VERSION' ) ) {
	define( 'PRESSTRACE_VERSION', '0.1.0' );
}

require_once __DIR__ . '/class-presstrace-clock.php';
require_once __DIR__ . '/class-presstrace-settings.php';
require_once __DIR__ . '/class-presstrace-sql.php';
require_once __DIR__ . '/class-presstrace-trace.php';
require_once __DIR__ . '/class-presstrace-components.php';
require_once __DIR__ . '/class-presstrace-namer.php';
require_once __DIR__ . '/class-presstrace-payload.php';
require_once __DIR__ . '/class-presstrace-db-capture.php';
require_once __DIR__ . '/class-presstrace-callback.php';
require_once __DIR__ . '/class-presstrace-hooks.php';
require_once __DIR__ . '/class-presstrace-http.php';
require_once __DIR__ . '/class-presstrace-errors.php';
require_once __DIR__ . '/class-presstrace-agent.php';

/**
 * Boots the agent.
 *
 * @param string $plugin_file Main plugin file.
 * @param string $loader_file Loader mu-plugin file, or an empty string.
 * @return void
 */
function presstrace_boot_agent( $plugin_file, $loader_file = '' ) {
	PressTrace_Agent::boot( $plugin_file, $loader_file );
}
