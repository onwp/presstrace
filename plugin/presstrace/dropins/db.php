<?php
/**
 * Plugin Name: PressTrace Database Drop-in
 * Description: Times database queries for PressTrace. Installed and removed by the PressTrace plugin.
 * Version: __PRESSTRACE_VERSION__
 * Author: PressTrace
 * License: GPL-2.0-or-later
 *
 * PRESSTRACE_DB_DROPIN
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'DB_USER' ) || ( defined( 'WP_INSTALLING' ) && WP_INSTALLING ) ) {
	return;
}

define( 'PRESSTRACE_DB_DROPIN_VERSION', '__PRESSTRACE_VERSION__' );

( static function () {
	$plugins = defined( 'WP_PLUGIN_DIR' ) ? WP_PLUGIN_DIR : WP_CONTENT_DIR . '/plugins';
	$src     = $plugins . '/__PRESSTRACE_PLUGIN_DIR__/src';

	// Fail safe: without the plugin files WordPress loads its default wpdb.
	if ( ! is_readable( $src . '/class-presstrace-db.php' ) || ! class_exists( 'wpdb', false ) ) {
		return;
	}

	require_once $src . '/class-presstrace-clock.php';
	require_once $src . '/class-presstrace-sql.php';
	require_once $src . '/class-presstrace-trace.php';
	require_once $src . '/class-presstrace-db-capture.php';
	require_once $src . '/class-presstrace-db.php';

	if ( ! class_exists( 'PressTrace_DB', false ) ) {
		return;
	}

	PressTrace_Db_Capture::boot_dropin();

	// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- this is the purpose of a db.php drop-in.
	$GLOBALS['wpdb'] = new PressTrace_DB( DB_USER, DB_PASSWORD, DB_NAME, DB_HOST );
} )();
