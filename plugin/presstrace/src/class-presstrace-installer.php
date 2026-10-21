<?php
/**
 * Installs and removes the loader mu-plugin and the db.php drop-in.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Installer', false ) ) {
	return;
}

/**
 * File management for the two drop-ins. Files are only removed or replaced when they carry our marker.
 */
final class PressTrace_Installer {

	/**
	 * Loader file name inside the mu-plugins directory.
	 */
	const LOADER = '000-presstrace.php';

	/**
	 * Marker in the loader file.
	 */
	const LOADER_MARKER = 'PRESSTRACE_LOADER';

	/**
	 * Marker in the db.php file.
	 */
	const DB_MARKER = 'PRESSTRACE_DB_DROPIN';

	/**
	 * Activation hook.
	 *
	 * @return void
	 */
	public static function activate() {
		if ( false === get_option( PressTrace_Settings::OPTION, false ) ) {
			add_option( PressTrace_Settings::OPTION, PressTrace_Settings::defaults(), '', true );
		}
		self::install();
	}

	/**
	 * Deactivation hook.
	 *
	 * @return void
	 */
	public static function deactivate() {
		self::remove();
	}

	/**
	 * Installs the loader and, when the slot is free or already ours, the db.php drop-in.
	 *
	 * @return array{loader:bool,db:bool} Whether each file is in place and ours after the call.
	 */
	public static function install() {
		return array(
			'loader' => self::install_loader(),
			'db'     => self::install_db(),
		);
	}

	/**
	 * Removes both files when they are ours.
	 *
	 * @return void
	 */
	public static function remove() {
		foreach ( array(
			self::loader_path() => self::LOADER_MARKER,
			self::db_path()     => self::DB_MARKER,
		) as $path => $marker ) {
			if ( self::is_ours( $path, $marker ) ) {
				wp_delete_file( $path );
			}
		}
	}

	/**
	 * Writes the loader mu-plugin.
	 *
	 * @return bool
	 */
	public static function install_loader() {
		$path = self::loader_path();
		if ( file_exists( $path ) && ! self::is_ours( $path, self::LOADER_MARKER ) ) {
			return false;
		}
		if ( ! wp_mkdir_p( dirname( $path ) ) ) {
			return false;
		}
		return self::write_template( PRESSTRACE_DIR . '/dropins/000-presstrace.php', $path );
	}

	/**
	 * Writes the db.php drop-in unless a foreign one exists.
	 *
	 * @return bool
	 */
	public static function install_db() {
		$path = self::db_path();
		if ( ( file_exists( $path ) || is_link( $path ) ) && ! self::is_ours( $path, self::DB_MARKER ) ) {
			return false;
		}
		return self::write_template( PRESSTRACE_DIR . '/dropins/db.php', $path );
	}

	/**
	 * Re-installs missing or outdated files. Cheap: it reads constants set by the loaded drop-ins first.
	 *
	 * @return void
	 */
	public static function maybe_sync() {
		$loader_ok = defined( 'PRESSTRACE_LOADER_VERSION' ) && PRESSTRACE_VERSION === PRESSTRACE_LOADER_VERSION;
		$db_ok     = defined( 'PRESSTRACE_DB_DROPIN_VERSION' ) && PRESSTRACE_VERSION === PRESSTRACE_DB_DROPIN_VERSION;
		if ( ( $loader_ok && $db_ok ) || get_transient( 'presstrace_sync_failed' ) ) {
			return;
		}

		$failed = false;
		if ( ! $loader_ok && ! self::install_loader() ) {
			$failed = true;
		}
		if ( ! $db_ok ) {
			// Our drop-in in an older version defines the constant; a free slot has no file. A foreign one is left alone.
			$path = self::db_path();
			if ( defined( 'PRESSTRACE_DB_DROPIN_VERSION' ) || ( ! file_exists( $path ) && ! is_link( $path ) ) ) {
				$failed = ! self::install_db() || $failed;
			}
		}
		if ( $failed ) {
			// Do not retry file writes on every admin request when the directory is not writable.
			set_transient( 'presstrace_sync_failed', 1, HOUR_IN_SECONDS );
		}
	}

	/**
	 * Returns the status of both files.
	 *
	 * @return array{loader:string,db:string,db_name:string}
	 */
	public static function status() {
		$loader = self::loader_path();
		$db     = self::db_path();

		$status = array(
			'loader'  => 'missing',
			'db'      => 'missing',
			'db_name' => '',
		);

		if ( file_exists( $loader ) ) {
			$status['loader'] = self::is_ours( $loader, self::LOADER_MARKER )
				? ( PRESSTRACE_VERSION === self::file_version( $loader ) ? 'ours' : 'outdated' )
				: 'foreign';
		}

		if ( file_exists( $db ) || is_link( $db ) ) {
			if ( self::is_ours( $db, self::DB_MARKER ) ) {
				$status['db'] = PRESSTRACE_VERSION === self::file_version( $db ) ? 'ours' : 'outdated';
			} else {
				$status['db']      = 'foreign';
				$status['db_name'] = self::header_name( $db );
			}
		}

		return $status;
	}

	/**
	 * Path of the loader mu-plugin.
	 *
	 * @return string
	 */
	public static function loader_path() {
		return WPMU_PLUGIN_DIR . '/' . self::LOADER;
	}

	/**
	 * Path of db.php.
	 *
	 * @return string
	 */
	public static function db_path() {
		return WP_CONTENT_DIR . '/db.php';
	}

	/**
	 * Returns true when a file carries the given marker.
	 *
	 * @param string $path   File.
	 * @param string $marker Marker.
	 * @return bool
	 */
	public static function is_ours( $path, $marker ) {
		$head = self::head( $path );
		return '' !== $head && false !== strpos( $head, $marker );
	}

	/**
	 * Copies a template, filling in the version and plugin location.
	 *
	 * @param string $template Template file.
	 * @param string $target   Target file.
	 * @return bool
	 */
	private static function write_template( $template, $target ) {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.
		$source = is_readable( $template ) ? file_get_contents( $template ) : false;
		if ( false === $source ) {
			return false;
		}

		$basename = plugin_basename( PRESSTRACE_FILE );
		if ( ! preg_match( '#^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\.php$#', $basename ) ) {
			return false;
		}

		$content = strtr(
			$source,
			array(
				'__PRESSTRACE_VERSION__'         => PRESSTRACE_VERSION,
				'__PRESSTRACE_PLUGIN_BASENAME__' => $basename,
				'__PRESSTRACE_PLUGIN_DIR__'      => dirname( $basename ),
			)
		);

		if ( is_link( $target ) ) {
			return false;
		}

		$temp = $target . '.' . wp_generate_password( 8, false ) . '.tmp';
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents, WordPress.PHP.NoSilencedErrors.Discouraged -- drop-ins must be written before WP_Filesystem is usable.
		if ( false === @file_put_contents( $temp, $content, LOCK_EX ) ) {
			return false;
		}
		// phpcs:ignore WordPress.WP.AlternativeFunctions.rename_rename, WordPress.PHP.NoSilencedErrors.Discouraged -- atomic replace.
		if ( ! @rename( $temp, $target ) ) {
			wp_delete_file( $temp );
			return false;
		}
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_chmod, WordPress.PHP.NoSilencedErrors.Discouraged -- match core file permissions.
		@chmod( $target, defined( 'FS_CHMOD_FILE' ) ? FS_CHMOD_FILE : 0644 );
		if ( function_exists( 'opcache_invalidate' ) ) {
			opcache_invalidate( $target, true );
		}
		return true;
	}

	/**
	 * Reads the first 2 KB of a file.
	 *
	 * @param string $path File.
	 * @return string
	 */
	private static function head( $path ) {
		if ( ! is_readable( $path ) ) {
			return '';
		}
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.
		$head = file_get_contents( $path, false, null, 0, 2048 );
		return false === $head ? '' : $head;
	}

	/**
	 * Reads the Version header of one of our files.
	 *
	 * @param string $path File.
	 * @return string
	 */
	private static function file_version( $path ) {
		return preg_match( '/^\s*\*\s*Version:\s*(\S+)/m', self::head( $path ), $m ) ? $m[1] : '';
	}

	/**
	 * Reads the Plugin Name header of a foreign drop-in.
	 *
	 * @param string $path File.
	 * @return string
	 */
	private static function header_name( $path ) {
		return preg_match( '/Plugin Name:\s*(.+)$/mi', self::head( $path ), $m ) ? trim( wp_strip_all_tags( $m[1] ) ) : '';
	}
}
