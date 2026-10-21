<?php
/**
 * Unit test bootstrap. Loads the pure classes without WordPress.
 *
 * @package PressTrace
 */

define( 'ABSPATH', '/srv/www/' );
define( 'WP_CONTENT_DIR', '/srv/www/wp-content' );
define( 'WP_PLUGIN_DIR', '/srv/www/wp-content/plugins' );
define( 'WPMU_PLUGIN_DIR', '/srv/www/wp-content/mu-plugins' );

require_once dirname( __DIR__ ) . '/vendor/autoload.php';

$src = dirname( __DIR__ ) . '/src/';
require_once $src . 'class-presstrace-clock.php';
require_once $src . 'class-presstrace-sql.php';
require_once $src . 'class-presstrace-trace.php';
require_once $src . 'class-presstrace-components.php';
require_once $src . 'class-presstrace-namer.php';
require_once $src . 'class-presstrace-settings.php';
require_once $src . 'class-presstrace-payload.php';
require_once $src . 'class-presstrace-errors.php';
require_once $src . 'class-presstrace-updater.php';
require_once __DIR__ . '/fixtures/callbacks.php';
