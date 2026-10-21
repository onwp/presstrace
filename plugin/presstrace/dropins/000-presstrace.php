<?php
/**
 * Plugin Name: PressTrace Loader
 * Description: Starts the PressTrace agent before other plugins load. Installed and removed by the PressTrace plugin.
 * Version: __PRESSTRACE_VERSION__
 * Author: PressTrace
 * License: GPL-2.0-or-later
 *
 * PRESSTRACE_LOADER
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

define( 'PRESSTRACE_LOADER_VERSION', '__PRESSTRACE_VERSION__' );

( static function () {
	$basename = '__PRESSTRACE_PLUGIN_BASENAME__';
	$plugin   = WP_PLUGIN_DIR . '/' . $basename;
	$boot     = dirname( $plugin ) . '/src/agent-bootstrap.php';

	// Fail safe: do nothing when the plugin was deleted or is not active.
	if ( ! is_readable( $boot ) ) {
		return;
	}

	$active = in_array( $basename, (array) get_option( 'active_plugins', array() ), true );
	if ( ! $active && is_multisite() ) {
		$network = (array) get_site_option( 'active_sitewide_plugins', array() );
		$active  = isset( $network[ $basename ] );
	}
	if ( ! $active ) {
		return;
	}

	require_once $boot;
	if ( function_exists( 'presstrace_boot_agent' ) ) {
		presstrace_boot_agent( $plugin, __FILE__ );
	}
} )();
