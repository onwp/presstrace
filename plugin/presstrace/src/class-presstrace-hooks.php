<?php
/**
 * Hook callback wrapping and plugin/theme load timing.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Hooks', false ) ) {
	return;
}

/**
 * Wraps non-core hook callbacks in place (keeping their unique ID index) and measures load phases.
 */
final class PressTrace_Hooks {

	/**
	 * Component resolver.
	 *
	 * @var PressTrace_Components
	 */
	private $resolver;

	/**
	 * Callback count signature per hook, so a hook is rescanned only when it changes.
	 *
	 * @var array<string, int>
	 */
	private $signatures = array();

	/**
	 * Unique callback IDs that must not be wrapped (core, agent, by-reference, not reflectable).
	 *
	 * @var array<string, bool>
	 */
	private $skip = array();

	/**
	 * Callback descriptions keyed by function or class::method.
	 *
	 * @var array<string, array|null>
	 */
	private $described = array();

	/**
	 * Offset (ms) of the previous load mark.
	 *
	 * @var float
	 */
	private $mark = 0.0;

	/**
	 * Whether the active plugins loop has started.
	 *
	 * @var bool
	 */
	private $plugins_started = false;

	/**
	 * Offset (ms) at setup_theme.
	 *
	 * @var float|null
	 */
	private $theme_start = null;

	/**
	 * Absolute path of our loader mu-plugin.
	 *
	 * @var string
	 */
	private $loader_file;

	/**
	 * Constructor.
	 *
	 * @param PressTrace_Components $resolver    Resolver.
	 * @param string                $loader_file Path of the loader mu-plugin.
	 */
	public function __construct( PressTrace_Components $resolver, $loader_file ) {
		$this->resolver    = $resolver;
		$this->loader_file = PressTrace_Components::normalize( $loader_file );
	}

	/**
	 * Points where every registered hook is scanned and new plugin or theme callbacks are wrapped.
	 * Each scan sees the callbacks registered so far, so it runs before the hooks that use them fire.
	 *
	 * @var array<int, array{0:string,1:int}>
	 */
	const SCAN_POINTS = array(
		array( 'plugins_loaded', PHP_INT_MIN ),
		array( 'after_setup_theme', PHP_INT_MAX ),
		array( 'init', PHP_INT_MAX ),
		array( 'wp_loaded', PHP_INT_MAX ),
		array( 'admin_init', PHP_INT_MAX ),
		array( 'rest_api_init', PHP_INT_MAX ),
		array( 'template_redirect', PHP_INT_MIN ),
	);

	/**
	 * Registers the hooks. Called from the loader mu-plugin.
	 *
	 * Callbacks are wrapped by scanning $wp_filter at a few points instead of from an "all" callback:
	 * an "all" callback runs on every apply_filters() call (tens of thousands per page) and costs far more
	 * than a handful of scans.
	 *
	 * @return void
	 */
	public function install() {
		$this->mark = PressTrace_Clock::now();

		foreach ( self::SCAN_POINTS as $point ) {
			add_action( $point[0], array( $this, 'scan' ), $point[1] );
		}

		add_action( 'mu_plugin_loaded', array( $this, 'on_mu_plugin_loaded' ), PHP_INT_MIN );
		add_action( 'network_plugin_loaded', array( $this, 'on_plugin_loaded' ), PHP_INT_MIN );
		add_action( 'plugin_loaded', array( $this, 'on_plugin_loaded' ), PHP_INT_MIN );
		add_filter( 'option_active_plugins', array( $this, 'on_plugins_list' ), PHP_INT_MAX );
		add_filter( 'site_option_active_sitewide_plugins', array( $this, 'on_plugins_list' ), PHP_INT_MAX );
		add_action( 'setup_theme', array( $this, 'on_setup_theme' ), PHP_INT_MAX );
		add_action( 'after_setup_theme', array( $this, 'on_after_setup_theme' ), PHP_INT_MIN );
	}

	/**
	 * Stops wrapping new callbacks. Existing wrappers stay but become pass-through once tracing ends.
	 *
	 * @return void
	 */
	public function uninstall() {
		foreach ( self::SCAN_POINTS as $point ) {
			remove_action( $point[0], array( $this, 'scan' ), $point[1] );
		}
		remove_filter( 'option_active_plugins', array( $this, 'on_plugins_list' ), PHP_INT_MAX );
		remove_filter( 'site_option_active_sitewide_plugins', array( $this, 'on_plugins_list' ), PHP_INT_MAX );
	}

	/**
	 * Wraps new callbacks on every hook that changed since the previous scan.
	 *
	 * Safe while a hook is running: WP_Hook iterates a copy of the current priority's callbacks, and the
	 * unique-ID keys are unchanged, so remove_filter() and has_filter() keep working.
	 *
	 * @return void
	 */
	public function scan() {
		if ( ! PressTrace_Trace::$active || empty( $GLOBALS['wp_filter'] ) ) {
			return;
		}
		foreach ( $GLOBALS['wp_filter'] as $hook => $wp_hook ) {
			if ( 'all' === $hook || ! is_object( $wp_hook ) || ! isset( $wp_hook->callbacks ) ) {
				continue;
			}
			$signature = count( $wp_hook->callbacks, COUNT_RECURSIVE );
			if ( isset( $this->signatures[ $hook ] ) && $this->signatures[ $hook ] === $signature ) {
				continue;
			}
			$this->signatures[ $hook ] = $signature;
			$this->wrap( (string) $hook, $wp_hook );
		}
	}

	/**
	 * Wraps every eligible callback of a hook, keeping priorities and unique-ID keys unchanged.
	 *
	 * @param string  $hook    Hook name.
	 * @param WP_Hook $wp_hook Hook object.
	 * @return void
	 */
	private function wrap( $hook, $wp_hook ) {
		foreach ( $wp_hook->callbacks as $priority => $entries ) {
			foreach ( $entries as $id => $entry ) {
				if ( ! isset( $entry['function'] ) ) {
					continue;
				}
				$function = $entry['function'];
				if ( $function instanceof PressTrace_Callback || isset( $this->skip[ $id ] ) ) {
					continue;
				}

				$info = $this->describe( $function );
				if ( null === $info || $info['by_ref'] || '' === $info['file'] || $this->resolver->is_ignored( $info['file'] ) ) {
					$this->skip[ $id ] = true;
					continue;
				}

				$component = $this->resolver->from_file( $info['file'] );
				if ( 'core' === $component ) {
					$this->skip[ $id ] = true;
					continue;
				}

				$wp_hook->callbacks[ $priority ][ $id ]['function'] = new PressTrace_Callback(
					$function,
					$hook,
					$component,
					$info['name'],
					$this->resolver->relative( $info['file'] ) . ':' . $info['line']
				);
			}
		}
	}

	/**
	 * Describes a callback, caching by function or class and method name (many objects share a method).
	 *
	 * @param mixed $function Callable.
	 * @return array|null
	 */
	private function describe( $function ) {
		$key = null;
		if ( is_string( $function ) ) {
			$key = $function;
		} elseif ( is_array( $function ) && isset( $function[0], $function[1] ) && is_string( $function[1] ) ) {
			$key = ( is_object( $function[0] ) ? get_class( $function[0] ) : (string) $function[0] ) . '::' . $function[1];
		}
		if ( null === $key ) {
			return PressTrace_Components::describe_callback( $function );
		}
		if ( ! array_key_exists( $key, $this->described ) ) {
			$info = PressTrace_Components::describe_callback( $function );
			if ( null !== $info && is_array( $function ) && is_object( $function[0] ) ) {
				$info['name'] = get_class( $function[0] ) . '->' . $function[1];
			}
			$this->described[ $key ] = $info;
		}
		return $this->described[ $key ];
	}

	/**
	 * Records the load time of a must-use plugin.
	 *
	 * @param string $file Plugin file.
	 * @return void
	 */
	public function on_mu_plugin_loaded( $file ) {
		$now = PressTrace_Clock::now();
		if ( PressTrace_Components::normalize( $file ) !== $this->loader_file ) {
			$this->add_load_span( 'plugin_load', $this->plugin_name( $file, defined( 'WPMU_PLUGIN_DIR' ) ? WPMU_PLUGIN_DIR : '' ), $file, $now );
		}
		$this->mark = PressTrace_Clock::now();
	}

	/**
	 * Records the load time of a regular or network plugin.
	 *
	 * @param string $file Plugin file.
	 * @return void
	 */
	public function on_plugin_loaded( $file ) {
		$now = PressTrace_Clock::now();

		// Map symlinked plugins (registered by core right before the include) to their slug.
		$dir = PressTrace_Components::normalize( dirname( $file ) );
		if ( isset( $GLOBALS['wp_plugin_paths'][ $dir ] ) && $GLOBALS['wp_plugin_paths'][ $dir ] !== $dir ) {
			$this->resolver->add( $GLOBALS['wp_plugin_paths'][ $dir ], 'plugin', basename( $dir ) );
		}

		$this->add_load_span( 'plugin_load', $this->plugin_name( $file, defined( 'WP_PLUGIN_DIR' ) ? WP_PLUGIN_DIR : '' ), $file, $now );
		$this->plugins_started = true;
		$this->mark            = PressTrace_Clock::now();
	}

	/**
	 * Sets the load mark when core reads the active plugin list, right before it includes the plugins.
	 *
	 * @param mixed $value Option value, returned unchanged.
	 * @return mixed
	 */
	public function on_plugins_list( $value ) {
		if ( ! $this->plugins_started && did_action( 'muplugins_loaded' ) && ! did_action( 'plugins_loaded' ) ) {
			$this->mark = PressTrace_Clock::now();
		}
		return $value;
	}

	/**
	 * Marks the start of theme loading.
	 *
	 * @return void
	 */
	public function on_setup_theme() {
		$this->theme_start = PressTrace_Clock::now();
	}

	/**
	 * Records theme load time (parent and child functions.php).
	 *
	 * @return void
	 */
	public function on_after_setup_theme() {
		if ( null === $this->theme_start ) {
			return;
		}
		$now        = PressTrace_Clock::now();
		$stylesheet = function_exists( 'get_stylesheet' ) ? (string) get_stylesheet() : '';
		if ( '' === $stylesheet ) {
			return;
		}
		$component = PressTrace_Components::clean( 'theme:' . $stylesheet );
		$duration  = $now - $this->theme_start;
		PressTrace_Trace::add_span(
			array(
				'kind'      => 'theme_load',
				'name'      => $stylesheet,
				'start'     => $this->theme_start,
				'duration'  => $duration,
				'component' => $component,
			)
		);
		PressTrace_Trace::add_component_time( $component, $duration, 0 );
		$this->theme_start = null;

		// Theme directories are registered by now.
		$this->resolver->refresh_themes();
	}

	/**
	 * Adds a plugin load span measured from the previous mark.
	 *
	 * @param string $kind Span kind.
	 * @param string $name Span name.
	 * @param string $file Plugin file.
	 * @param float  $now  Offset now.
	 * @return void
	 */
	private function add_load_span( $kind, $name, $file, $now ) {
		$component = $this->resolver->from_file( $file );
		$duration  = max( 0.0, $now - $this->mark );
		PressTrace_Trace::add_span(
			array(
				'kind'      => $kind,
				'name'      => $name,
				'start'     => $this->mark,
				'duration'  => $duration,
				'component' => $component,
			)
		);
		PressTrace_Trace::add_component_time( $component, $duration, 0 );
	}

	/**
	 * Returns the plugin file relative to its plugins directory.
	 *
	 * @param string $file Plugin file.
	 * @param string $base Plugins directory.
	 * @return string
	 */
	private function plugin_name( $file, $base ) {
		$file = PressTrace_Components::normalize( $file );
		$base = rtrim( PressTrace_Components::normalize( $base ), '/' ) . '/';
		if ( '/' !== $base && 0 === strpos( $file, $base ) ) {
			return substr( $file, strlen( $base ) );
		}
		return basename( $file );
	}
}
