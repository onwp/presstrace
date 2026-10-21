<?php
/**
 * Uninstall: removes the settings and any PressTrace drop-ins left behind.
 *
 * @package PressTrace
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

if ( ! defined( 'PRESSTRACE_VERSION' ) ) {
	define( 'PRESSTRACE_VERSION', '0.1.0' );
}
if ( ! defined( 'PRESSTRACE_FILE' ) ) {
	define( 'PRESSTRACE_FILE', __DIR__ . '/presstrace.php' );
}
if ( ! defined( 'PRESSTRACE_DIR' ) ) {
	define( 'PRESSTRACE_DIR', __DIR__ );
}

require_once __DIR__ . '/src/class-presstrace-settings.php';
require_once __DIR__ . '/src/class-presstrace-installer.php';

PressTrace_Installer::remove();

/**
 * Deletes the options and transients PressTrace keeps for the current site.
 */
function presstrace_uninstall_site() {
	delete_option( PressTrace_Settings::OPTION );
	delete_transient( 'presstrace_sync_failed' );
}

if ( is_multisite() ) {
	// The plugin can be activated per site, so every site in the network may hold its own settings.
	foreach ( get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	) as $presstrace_site_id ) {
		switch_to_blog( (int) $presstrace_site_id );
		presstrace_uninstall_site();
		restore_current_blog();
	}
} else {
	presstrace_uninstall_site();
}
delete_site_transient( 'presstrace_latest_release' );

// The marker of the last failed send (see PressTrace_Agent::backoff_file()).
foreach ( (array) glob( trailingslashit( get_temp_dir() ) . 'presstrace-backoff-*' ) as $presstrace_backoff ) {
	wp_delete_file( $presstrace_backoff );
}
