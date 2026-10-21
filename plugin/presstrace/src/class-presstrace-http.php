<?php
/**
 * External HTTP capture through the WordPress HTTP API.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Http', false ) ) {
	return;
}

/**
 * Pairs http_request_args with pre_http_request (short circuits) and http_api_debug (completed requests).
 */
final class PressTrace_Http {

	/**
	 * Argument key used to pair the start and end of a request.
	 */
	const KEY = '_presstrace_id';

	/**
	 * Argument flag that marks the agent's own requests to the app.
	 */
	const INTERNAL = '_presstrace_internal';

	/**
	 * Component resolver.
	 *
	 * @var PressTrace_Components
	 */
	private $resolver;

	/**
	 * Requests in flight, keyed by pairing ID.
	 *
	 * @var array<int, array>
	 */
	private $pending = array();

	/**
	 * Next pairing ID.
	 *
	 * @var int
	 */
	private $next = 0;

	/**
	 * Constructor.
	 *
	 * @param PressTrace_Components $resolver Resolver.
	 */
	public function __construct( PressTrace_Components $resolver ) {
		$this->resolver = $resolver;
	}

	/**
	 * Registers the hooks.
	 *
	 * @return void
	 */
	public function install() {
		add_filter( 'http_request_args', array( $this, 'on_request_args' ), PHP_INT_MAX, 2 );
		add_filter( 'pre_http_request', array( $this, 'on_pre_http_request' ), PHP_INT_MAX, 3 );
		add_action( 'http_api_debug', array( $this, 'on_http_api_debug' ), PHP_INT_MAX, 5 );
	}

	/**
	 * Removes the hooks.
	 *
	 * @return void
	 */
	public function uninstall() {
		remove_filter( 'http_request_args', array( $this, 'on_request_args' ), PHP_INT_MAX );
		remove_filter( 'pre_http_request', array( $this, 'on_pre_http_request' ), PHP_INT_MAX );
		remove_action( 'http_api_debug', array( $this, 'on_http_api_debug' ), PHP_INT_MAX );
		$this->pending = array();
	}

	/**
	 * Starts timing a request.
	 *
	 * @param array  $args Request arguments.
	 * @param string $url  URL.
	 * @return array
	 */
	public function on_request_args( $args, $url ) {
		if ( ! PressTrace_Trace::$active || ! is_array( $args ) || ! empty( $args[ self::INTERNAL ] ) ) {
			return $args;
		}

		$id = ++$this->next;

		$frames    = self::caller_frames();
		$component = PressTrace_Callback::current_component();

		$this->pending[ $id ] = array(
			'start'     => PressTrace_Clock::now(),
			'url'       => (string) $url,
			'method'    => isset( $args['method'] ) ? (string) $args['method'] : 'GET',
			'component' => $this->resolver->from_frames( $frames, null === $component ? 'core' : $component ),
			'stack'     => $this->resolver->stack( $frames ),
		);

		$args[ self::KEY ] = $id;
		return $args;
	}

	/**
	 * Returns the backtrace starting at the code that called the HTTP API (frames inside WP_Http and the
	 * wp_remote_*() wrappers are dropped).
	 *
	 * @return array[]
	 */
	private static function caller_frames() {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_debug_backtrace -- caller attribution.
		$frames = debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS, 40 );
		$outer  = 0;
		foreach ( $frames as $i => $frame ) {
			if ( ( isset( $frame['class'] ) && 'WP_Http' === $frame['class'] ) || ( ! isset( $frame['class'] ) && isset( $frame['function'] ) && preg_match( '/^(wp_safe_remote_|wp_remote_)(request|get|post|head)$|^download_url$/', $frame['function'] ) ) ) {
				$outer = $i;
			}
		}
		return array_slice( $frames, $outer );
	}

	/**
	 * Ends timing when a filter short-circuits the request. Always returns $preempt unchanged.
	 *
	 * @param false|array|WP_Error $preempt Short-circuit value.
	 * @param array                $args    Request arguments.
	 * @param string               $url     URL.
	 * @return false|array|WP_Error
	 */
	public function on_pre_http_request( $preempt, $args, $url ) {
		if ( false !== $preempt && is_array( $args ) && isset( $args[ self::KEY ] ) ) {
			$this->finish( (int) $args[ self::KEY ], $preempt );
		}
		return $preempt;
	}

	/**
	 * Ends timing when the transport returns.
	 *
	 * @param array|WP_Error $response Response.
	 * @param string         $context  Context, "response" for completed requests.
	 * @param string         $class    Transport class.
	 * @param array          $args     Request arguments.
	 * @param string         $url      URL.
	 * @return void
	 */
	public function on_http_api_debug( $response, $context, $class, $args, $url ) {
		if ( 'response' === $context && is_array( $args ) && isset( $args[ self::KEY ] ) ) {
			$this->finish( (int) $args[ self::KEY ], $response );
		}
	}

	/**
	 * Records a finished request.
	 *
	 * @param int                  $id       Pairing ID.
	 * @param array|WP_Error|mixed $response Response.
	 * @return void
	 */
	private function finish( $id, $response ) {
		if ( ! isset( $this->pending[ $id ] ) ) {
			return;
		}
		$request = $this->pending[ $id ];
		unset( $this->pending[ $id ] );

		$duration = max( 0.0, PressTrace_Clock::now() - $request['start'] );
		$status   = null;
		$error    = null;

		if ( is_wp_error( $response ) ) {
			$error = $response->get_error_message();
		} elseif ( is_array( $response ) && isset( $response['response']['code'] ) && is_numeric( $response['response']['code'] ) ) {
			$status = (int) $response['response']['code'];
		}

		$method = PressTrace_Namer::method( $request['method'] );
		$host   = PressTrace_Namer::host( $request['url'] );

		PressTrace_Trace::$http_time += $duration;
		++PressTrace_Trace::$http_count;

		PressTrace_Trace::add_span(
			array(
				'kind'      => 'http',
				'name'      => ( '' === $host ? 'unknown' : $host ) . ' ' . $method,
				'start'     => $request['start'],
				'duration'  => $duration,
				'component' => $request['component'],
				'url'       => PressTrace_Namer::clean_url( $request['url'] ),
				'method'    => $method,
				'status'    => $status,
				'error'     => $error,
				'stack'     => array() === $request['stack'] ? null : $request['stack'],
			)
		);
	}
}
