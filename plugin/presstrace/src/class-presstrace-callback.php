<?php
/**
 * Timing wrapper placed in WP_Hook::$callbacks in place of a plugin or theme callback.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Callback', false ) ) {
	return;
}

/**
 * Invokable wrapper that measures inclusive and self time of one hook callback.
 */
final class PressTrace_Callback {

	/**
	 * The original callable.
	 *
	 * @var callable
	 */
	private $callback;

	/**
	 * Hook name.
	 *
	 * @var string
	 */
	public $hook;

	/**
	 * Owning component.
	 *
	 * @var string
	 */
	public $component;

	/**
	 * Display name of the callback.
	 *
	 * @var string
	 */
	public $name;

	/**
	 * Defining file and line relative to ABSPATH.
	 *
	 * @var string
	 */
	public $file;

	/**
	 * Stack of running wrappers: array( wrapper, start hrtime, child nanoseconds ).
	 *
	 * @var array[]
	 */
	private static $stack = array();

	/**
	 * Constructor.
	 *
	 * @param callable $callback  Original callback.
	 * @param string   $hook      Hook name.
	 * @param string   $component Component.
	 * @param string   $name      Display name.
	 * @param string   $file      Relative file:line.
	 */
	public function __construct( $callback, $hook, $component, $name, $file ) {
		$this->callback  = $callback;
		$this->hook      = $hook;
		$this->component = $component;
		$this->name      = $name;
		$this->file      = $file;
	}

	/**
	 * Returns the original callable, for code that inspects WP_Hook::$callbacks.
	 *
	 * @return callable
	 */
	public function get_wrapped_callback() {
		return $this->callback;
	}

	/**
	 * Calls the original callback and records its timing.
	 *
	 * @param mixed ...$args Hook arguments.
	 * @return mixed
	 */
	public function __invoke( ...$args ) {
		if ( ! PressTrace_Trace::$active ) {
			return call_user_func_array( $this->callback, $args );
		}

		self::$stack[] = array( $this, hrtime( true ), 0 );
		try {
			return ( $this->callback )( ...$args );
		} finally {
			self::close_top();
		}
	}

	/**
	 * Returns the component of the innermost running wrapper.
	 *
	 * @return string|null
	 */
	public static function current_component() {
		$top = end( self::$stack );
		return false === $top ? null : $top[0]->component;
	}

	/**
	 * Closes wrappers that never returned (exit or wp_die inside a callback). Called at shutdown.
	 *
	 * @return void
	 */
	public static function close_all() {
		while ( array() !== self::$stack ) {
			self::close_top();
		}
	}

	/**
	 * Pops the innermost wrapper and records it.
	 *
	 * @return void
	 */
	private static function close_top() {
		$end   = hrtime( true );
		$frame = array_pop( self::$stack );
		if ( null === $frame ) {
			return;
		}

		$inclusive = $end - $frame[1];
		$self      = $inclusive - $frame[2];

		$depth = count( self::$stack );
		if ( $depth > 0 ) {
			self::$stack[ $depth - 1 ][2] += $inclusive;
		}

		$wrapper = $frame[0];
		$self_ms = $self / 1e6;
		PressTrace_Trace::add_component_time( $wrapper->component, $self_ms, 1 );

		$inclusive_ms = $inclusive / 1e6;
		if ( $inclusive_ms >= PressTrace_Trace::SLOW_MS ) {
			PressTrace_Trace::add_span(
				array(
					'kind'      => 'callback',
					'name'      => $wrapper->name,
					'start'     => PressTrace_Clock::from_hr( $frame[1] ),
					'duration'  => $inclusive_ms,
					'self'      => $self_ms,
					'component' => $wrapper->component,
					// Actions are counted in $wp_actions before their callbacks run.
					'hook'      => ( isset( $GLOBALS['wp_actions'][ $wrapper->hook ] ) ? 'action:' : 'filter:' ) . $wrapper->hook,
					'file'      => $wrapper->file,
				)
			);
		}
	}
}
