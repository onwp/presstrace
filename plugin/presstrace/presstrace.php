<?php
/**
 * Plugin Name:       PressTrace
 * Plugin URI:        https://github.com/onwp/presstrace-wordpress-apm
 * Description:       APM agent for WordPress. Finds slow plugins, hooks, queries, external calls and PHP errors, and sends them to your self-hosted PressTrace app.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            PressTrace
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       presstrace
 * Domain Path:       /languages
 * Update URI:        https://github.com/onwp/presstrace-wordpress-apm
 *
 * Copyright (C) 2026 Serhat Aksakal
 *
 * This program is free software; you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation; either version 2 of the
 * License, or (at your option) any later version.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'PRESSTRACE_VERSION' ) ) {
	define( 'PRESSTRACE_VERSION', '0.1.0' );
}
define( 'PRESSTRACE_FILE', __FILE__ );
define( 'PRESSTRACE_DIR', __DIR__ );

require_once __DIR__ . '/src/class-presstrace-settings.php';
require_once __DIR__ . '/src/class-presstrace-installer.php';

// Normally the loader mu-plugin boots the agent. If it is missing, boot from here with reduced coverage.
if ( ! defined( 'PRESSTRACE_LOADER_VERSION' ) ) {
	require_once __DIR__ . '/src/agent-bootstrap.php';
	presstrace_boot_agent( __FILE__, '' );
}

require_once __DIR__ . '/src/class-presstrace-updater.php';
PressTrace_Updater::init();

add_action(
	'init',
	static function () {
		load_plugin_textdomain( 'presstrace', false, dirname( plugin_basename( PRESSTRACE_FILE ) ) . '/languages' );
	}
);

register_activation_hook( __FILE__, array( 'PressTrace_Installer', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'PressTrace_Installer', 'deactivate' ) );

if ( is_admin() ) {
	require_once __DIR__ . '/src/class-presstrace-admin.php';
	PressTrace_Admin::init();
}
