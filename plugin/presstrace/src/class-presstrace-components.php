<?php
/**
 * Maps files, callbacks and backtraces to components (core, plugin:slug, theme:slug, ...).
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Components', false ) ) {
	return;
}

/**
 * Component resolver built from an ordered directory prefix table.
 */
final class PressTrace_Components {

	/**
	 * Directory prefixes, longest first. Each entry: array( prefix, type, fixed slug or null ).
	 *
	 * @var array<int, array{0:string,1:string,2:string|null}>
	 */
	private $prefixes = array();

	/**
	 * The WordPress root directory, normalised with a trailing slash.
	 *
	 * @var string
	 */
	private $abspath;

	/**
	 * Parent directory of wp-content, used to shorten paths outside ABSPATH.
	 *
	 * @var string
	 */
	private $content_parent = '';

	/**
	 * Files whose frames are skipped when walking a backtrace (the agent itself).
	 *
	 * @var string[]
	 */
	private $ignored_prefixes = array();

	/**
	 * Per-file component cache.
	 *
	 * @var array<string, string>
	 */
	private $cache = array();

	/**
	 * Per-file is_ignored() cache.
	 *
	 * @var array<string, bool>
	 */
	private $ignored_cache = array();

	/**
	 * Per-file relative() cache.
	 *
	 * @var array<string, string>
	 */
	private $relative_cache = array();

	/**
	 * Constructor.
	 *
	 * @param string $abspath WordPress root directory.
	 */
	public function __construct( $abspath ) {
		$this->abspath = self::dir( $abspath );
	}

	/**
	 * Builds a resolver from the current WordPress constants and globals.
	 *
	 * @param string $agent_dir The PressTrace plugin directory.
	 * @return self
	 */
	public static function from_environment( $agent_dir ) {
		$resolver = new self( ABSPATH );
		$resolver->refresh( $agent_dir );
		return $resolver;
	}

	/**
	 * Rebuilds the prefix table from the current environment.
	 *
	 * @param string $agent_dir The PressTrace plugin directory.
	 * @return void
	 */
	public function refresh( $agent_dir ) {
		$this->prefixes       = array();
		$this->cache          = array();
		$this->ignored_cache  = array();
		$this->relative_cache = array();

		$content_dir          = defined( 'WP_CONTENT_DIR' ) ? WP_CONTENT_DIR : $this->abspath . 'wp-content';
		$this->content_parent = self::dir( dirname( $content_dir ) );

		$this->add( $this->abspath . 'wp-admin', 'core' );
		$this->add( $this->abspath . 'wp-includes', 'core' );
		$this->add( $content_dir, 'dropin' );
		$this->add( defined( 'WP_PLUGIN_DIR' ) ? WP_PLUGIN_DIR : $content_dir . '/plugins', 'plugin' );
		$this->add( defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : $content_dir . '/mu-plugins', 'mu-plugin' );
		$this->add( $content_dir . '/themes', 'theme' );

		if ( ! empty( $GLOBALS['wp_theme_directories'] ) && is_array( $GLOBALS['wp_theme_directories'] ) ) {
			foreach ( $GLOBALS['wp_theme_directories'] as $theme_dir ) {
				$this->add( $theme_dir, 'theme' );
			}
		}

		// Symlinked plugins: Reflection reports real paths, map them back to the slug.
		if ( ! empty( $GLOBALS['wp_plugin_paths'] ) && is_array( $GLOBALS['wp_plugin_paths'] ) ) {
			foreach ( $GLOBALS['wp_plugin_paths'] as $plugin_dir => $real_dir ) {
				if ( $plugin_dir !== $real_dir ) {
					$this->add( $real_dir, 'plugin', basename( $plugin_dir ) );
				}
			}
		}

		$this->ignored_prefixes = array( self::dir( $agent_dir ) );
		$real_agent             = realpath( $agent_dir );
		if ( false !== $real_agent ) {
			$this->ignored_prefixes[] = self::dir( $real_agent );
		}
	}

	/**
	 * Adds theme directories registered after the resolver was built.
	 *
	 * @return void
	 */
	public function refresh_themes() {
		if ( empty( $GLOBALS['wp_theme_directories'] ) || ! is_array( $GLOBALS['wp_theme_directories'] ) ) {
			return;
		}
		$known = array();
		foreach ( $this->prefixes as $entry ) {
			$known[ $entry[0] ] = true;
		}
		foreach ( $GLOBALS['wp_theme_directories'] as $theme_dir ) {
			if ( ! isset( $known[ self::dir( $theme_dir ) ] ) ) {
				$this->add( $theme_dir, 'theme' );
			}
		}
	}

	/**
	 * Adds a directory prefix.
	 *
	 * @param string      $dir  Directory.
	 * @param string      $type One of core, plugin, mu-plugin, theme, dropin.
	 * @param string|null $slug Fixed slug for every file under the directory.
	 * @return void
	 */
	public function add( $dir, $type, $slug = null ) {
		$dir = self::dir( $dir );
		if ( '/' === $dir ) {
			return;
		}
		$this->prefixes[] = array( $dir, $type, $slug );
		usort(
			$this->prefixes,
			static function ( $a, $b ) {
				return strlen( $b[0] ) - strlen( $a[0] );
			}
		);
		$this->cache          = array();
		$this->relative_cache = array();
	}

	/**
	 * Marks a directory or a single file whose frames are ignored when walking backtraces.
	 *
	 * @param string $path   Directory or file.
	 * @param bool   $is_dir Whether $path is a directory.
	 * @return void
	 */
	public function ignore( $path, $is_dir = true ) {
		$this->ignored_prefixes[] = $is_dir ? self::dir( $path ) : self::normalize( $path );
		$this->ignored_cache      = array();
	}

	/**
	 * Resolves a file path to a component string.
	 *
	 * @param string $file Absolute file path.
	 * @return string
	 */
	public function from_file( $file ) {
		if ( ! is_string( $file ) || '' === $file ) {
			return 'unknown';
		}
		if ( isset( $this->cache[ $file ] ) ) {
			return $this->cache[ $file ];
		}

		$path      = self::normalize( $file );
		$component = null;

		foreach ( $this->prefixes as $entry ) {
			list( $prefix, $type, $slug ) = $entry;
			if ( 0 !== strpos( $path, $prefix ) ) {
				continue;
			}
			$rest = substr( $path, strlen( $prefix ) );

			if ( 'core' === $type ) {
				$component = 'core';
			} elseif ( null !== $slug ) {
				$component = $type . ':' . $slug;
			} elseif ( 'dropin' === $type ) {
				// Only files directly in wp-content are drop-ins; anything deeper is unknown (uploads, cache).
				$component = ( false === strpos( $rest, '/' ) ) ? 'dropin:' . $rest : 'unknown';
			} else {
				// strpos, not strtok: strtok has global state and this runs inside error handlers and filters.
				$slash   = strpos( $rest, '/' );
				$segment = false === $slash ? $rest : substr( $rest, 0, $slash );
				if ( '' === $segment ) {
					$component = 'unknown';
				} else {
					if ( false === strpos( $rest, '/' ) && '.php' === substr( $segment, -4 ) ) {
						$segment = substr( $segment, 0, -4 );
					}
					$component = $type . ':' . $segment;
				}
			}
			break;
		}

		if ( null === $component ) {
			// Files in the WordPress root (index.php, wp-settings.php, wp-blog-header.php) are core.
			if ( 0 === strpos( $path, $this->abspath ) && false === strpos( substr( $path, strlen( $this->abspath ) ), '/' ) ) {
				$component = 'core';
			} else {
				$component = 'unknown';
			}
		}

		$component            = self::clean( $component );
		$this->cache[ $file ] = $component;
		return $component;
	}

	/**
	 * Makes a component id safe for the payload: folder names with spaces become dashes, at most 200 chars.
	 *
	 * @param string $component Component id.
	 * @return string
	 */
	public static function clean( $component ) {
		return substr( (string) preg_replace( '/\s+/', '-', (string) $component ), 0, 200 );
	}

	/**
	 * Returns true when the file belongs to the agent itself.
	 *
	 * @param string $file File path.
	 * @return bool
	 */
	public function is_ignored( $file ) {
		if ( isset( $this->ignored_cache[ $file ] ) ) {
			return $this->ignored_cache[ $file ];
		}
		$path    = self::normalize( $file );
		$ignored = false;
		foreach ( $this->ignored_prefixes as $prefix ) {
			if ( 0 === strpos( $path, $prefix ) ) {
				$ignored = true;
				break;
			}
		}
		$this->ignored_cache[ $file ] = $ignored;
		return $ignored;
	}

	/**
	 * Returns the path relative to ABSPATH (or to the parent of wp-content when outside ABSPATH).
	 *
	 * @param string $file Absolute path.
	 * @return string
	 */
	public function relative( $file ) {
		$file = (string) $file;
		if ( ! isset( $this->relative_cache[ $file ] ) ) {
			$this->relative_cache[ $file ] = $this->compute_relative( $file );
		}
		return $this->relative_cache[ $file ];
	}

	/**
	 * Computes relative().
	 *
	 * @param string $file Absolute path.
	 * @return string
	 */
	private function compute_relative( $file ) {
		$path = self::normalize( $file );
		if ( 0 === strpos( $path, $this->abspath ) ) {
			return substr( $path, strlen( $this->abspath ) );
		}
		if ( '' !== $this->content_parent && 0 === strpos( $path, $this->content_parent ) ) {
			return substr( $path, strlen( $this->content_parent ) );
		}
		foreach ( $this->prefixes as $entry ) {
			if ( null !== $entry[2] && 0 === strpos( $path, $entry[0] ) ) {
				return 'wp-content/plugins/' . $entry[2] . '/' . substr( $path, strlen( $entry[0] ) );
			}
		}
		return basename( $path );
	}

	/**
	 * Resolves the component that owns the first non-core, non-agent frame of a backtrace.
	 *
	 * Frames are arrays with 'file' keys as returned by debug_backtrace(). The frame's file is where
	 * the call happened, so the first frame whose file is outside core identifies the calling code.
	 *
	 * @param array  $frames   Backtrace frames, innermost first.
	 * @param string $fallback Component to use when every frame is core.
	 * @return string
	 */
	public function from_frames( array $frames, $fallback = 'core' ) {
		foreach ( $frames as $frame ) {
			if ( empty( $frame['file'] ) || $this->is_ignored( $frame['file'] ) ) {
				continue;
			}
			$component = $this->from_file( $frame['file'] );
			if ( 'core' === $component || 'unknown' === $component || 'dropin:db.php' === $component ) {
				continue;
			}
			return $component;
		}
		return $fallback;
	}

	/**
	 * Formats backtrace frames as "file:line function" strings.
	 *
	 * @param array $frames Backtrace frames, innermost first.
	 * @param int   $max    Maximum number of frames.
	 * @return string[]
	 */
	public function stack( array $frames, $max = 15 ) {
		$out    = array();
		$callee = null;
		foreach ( $frames as $frame ) {
			$function = isset( $frame['function'] ) ? (string) $frame['function'] : '';
			if ( isset( $frame['class'] ) ) {
				$function = $frame['class'] . ( isset( $frame['type'] ) ? $frame['type'] : '::' ) . $function;
			}
			if ( empty( $frame['file'] ) ) {
				// A callback invoked through call_user_func_array() has no call site; remember its name.
				$callee = $function;
				continue;
			}
			if ( $this->is_ignored( $frame['file'] ) ) {
				// A frame called from the PressTrace wrapper is the wrapped callback (PHP may inline call_user_func_array).
				if ( 'call_user_func_array' !== $function && 'call_user_func' !== $function ) {
					$callee = $function;
				}
				continue;
			}
			if ( 'PressTrace_Callback->__invoke' === $function && null !== $callee ) {
				// Show the wrapped callback instead of the PressTrace wrapper.
				$function = $callee;
			}
			$callee = null;
			$out[]  = $this->relative( $frame['file'] ) . ':' . ( isset( $frame['line'] ) ? (int) $frame['line'] : 0 ) . ( '' !== $function ? ' ' . $function : '' );
			if ( count( $out ) >= $max ) {
				break;
			}
		}
		return $out;
	}

	/**
	 * Describes a callable: display name, defining file, start line and whether it takes by-ref params.
	 *
	 * @param mixed $callback Any callable.
	 * @return array{name:string,file:string,line:int,by_ref:bool}|null Null when the callable cannot be reflected.
	 */
	public static function describe_callback( $callback ) {
		try {
			if ( $callback instanceof Closure ) {
				$ref  = new ReflectionFunction( $callback );
				$name = '{closure}';
			} elseif ( is_string( $callback ) && false === strpos( $callback, '::' ) ) {
				if ( ! function_exists( $callback ) ) {
					return null;
				}
				$ref  = new ReflectionFunction( $callback );
				$name = $callback;
			} elseif ( is_string( $callback ) ) {
				list( $class, $method ) = explode( '::', $callback, 2 );
				$ref                    = self::method( $class, $method );
				$name                   = $class . '::' . $method;
			} elseif ( is_array( $callback ) && 2 === count( $callback ) && isset( $callback[0], $callback[1] ) && is_string( $callback[1] ) ) {
				$class = is_object( $callback[0] ) ? get_class( $callback[0] ) : (string) $callback[0];
				$ref   = self::method( $class, $callback[1] );
				$name  = $class . ( is_object( $callback[0] ) ? '->' : '::' ) . $callback[1];
			} elseif ( is_object( $callback ) && method_exists( $callback, '__invoke' ) ) {
				$ref  = new ReflectionMethod( $callback, '__invoke' );
				$name = get_class( $callback ) . '->__invoke';
			} else {
				return null;
			}

			if ( null === $ref ) {
				return null;
			}

			$by_ref = false;
			foreach ( $ref->getParameters() as $param ) {
				if ( $param->isPassedByReference() ) {
					$by_ref = true;
					break;
				}
			}

			$file = $ref->getFileName();

			return array(
				'name'   => $name,
				'file'   => false === $file ? '' : (string) $file,
				'line'   => (int) $ref->getStartLine(),
				'by_ref' => $by_ref,
			);
		} catch ( ReflectionException $e ) {
			return null;
		}
	}

	/**
	 * Reflects a method, falling back to the class file for magic (__call) methods.
	 *
	 * @param string $class  Class name.
	 * @param string $method Method name.
	 * @return ReflectionMethod|null
	 * @throws ReflectionException When reflection fails.
	 */
	private static function method( $class, $method ) {
		if ( ! class_exists( $class, false ) && ! interface_exists( $class, false ) && ! trait_exists( $class, false ) ) {
			return null;
		}
		if ( method_exists( $class, $method ) ) {
			return new ReflectionMethod( $class, $method );
		}
		// Magic method: attribute the call to the class's __call implementation.
		$class_ref = new ReflectionClass( $class );
		if ( $class_ref->hasMethod( '__call' ) ) {
			return $class_ref->getMethod( '__call' );
		}
		return null;
	}

	/**
	 * Normalises slashes.
	 *
	 * @param string $path Path.
	 * @return string
	 */
	public static function normalize( $path ) {
		$path = str_replace( '\\', '/', (string) $path );
		if ( false === strpos( $path, '//' ) ) {
			return $path;
		}
		return preg_replace( '|(?<=.)/+|', '/', $path );
	}

	/**
	 * Normalises a directory and appends a trailing slash.
	 *
	 * @param string $dir Directory.
	 * @return string
	 */
	private static function dir( $dir ) {
		return rtrim( self::normalize( $dir ), '/' ) . '/';
	}
}
