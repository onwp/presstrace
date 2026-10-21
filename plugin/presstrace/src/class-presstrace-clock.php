<?php
/**
 * Monotonic clock relative to the start of the request.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Clock', false ) ) {
	return;
}

/**
 * Converts hrtime readings into millisecond offsets from REQUEST_TIME_FLOAT.
 */
final class PressTrace_Clock {

	/**
	 * The hrtime reading (nanoseconds) taken when the clock was initialised.
	 *
	 * @var int|null
	 */
	private static $hr0 = null;

	/**
	 * Milliseconds between the request start and the moment $hr0 was taken.
	 *
	 * @var float
	 */
	private static $offset0 = 0.0;

	/**
	 * Request start as a Unix timestamp with microseconds.
	 *
	 * @var float
	 */
	private static $request_start = 0.0;

	/**
	 * Initialises the clock once per request. Safe to call repeatedly.
	 *
	 * @return void
	 */
	public static function init() {
		if ( null !== self::$hr0 ) {
			return;
		}

		$now       = microtime( true );
		self::$hr0 = hrtime( true );

		$start = isset( $_SERVER['REQUEST_TIME_FLOAT'] ) ? (float) $_SERVER['REQUEST_TIME_FLOAT'] : $now;
		if ( $start <= 0 || $start > $now ) {
			$start = $now;
		}

		self::$request_start = $start;
		self::$offset0       = ( $now - $start ) * 1000;
	}

	/**
	 * Returns the current offset from the request start in milliseconds.
	 *
	 * @return float
	 */
	public static function now() {
		return self::from_hr( hrtime( true ) );
	}

	/**
	 * Converts an hrtime reading into a millisecond offset from the request start.
	 *
	 * @param int $hr The hrtime( true ) value.
	 * @return float
	 */
	public static function from_hr( $hr ) {
		if ( null === self::$hr0 ) {
			self::init();
		}
		return self::$offset0 + ( $hr - self::$hr0 ) / 1e6;
	}

	/**
	 * Converts a Unix timestamp (seconds, float) into an offset from the request start.
	 *
	 * @param float $timestamp Unix timestamp with microseconds.
	 * @return float
	 */
	public static function from_timestamp( $timestamp ) {
		if ( null === self::$hr0 ) {
			self::init();
		}
		return max( 0.0, ( (float) $timestamp - self::$request_start ) * 1000 );
	}

	/**
	 * Returns the request start as a Unix timestamp with microseconds.
	 *
	 * @return float
	 */
	public static function request_start() {
		if ( null === self::$hr0 ) {
			self::init();
		}
		return self::$request_start;
	}
}
