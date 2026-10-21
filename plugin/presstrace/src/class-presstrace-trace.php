<?php
/**
 * In-memory store for the spans, totals and errors of the current request.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Trace', false ) ) {
	return;
}

/**
 * Request-scoped collector. Static for speed: it is touched on every query and wrapped callback.
 */
final class PressTrace_Trace {

	/**
	 * Maximum number of spans in one transaction.
	 */
	const MAX_SPANS = 500;

	/**
	 * The store is pruned to MAX_SPANS whenever it reaches this size, to bound memory.
	 */
	const PRUNE_AT = 1000;

	/**
	 * Maximum number of unique errors per transaction.
	 */
	const MAX_ERRORS = 50;

	/**
	 * Threshold in milliseconds for stacks and per-callback spans.
	 */
	const SLOW_MS = 1.0;

	/**
	 * Whether the current request is being traced.
	 *
	 * @var bool
	 */
	public static $active = false;

	/**
	 * Collected spans (may contain internal keys prefixed with "_").
	 *
	 * @var array[]
	 */
	private static $spans = array();

	/**
	 * Number of spans currently stored.
	 *
	 * @var int
	 */
	private static $span_count = 0;

	/**
	 * Spans discarded by pruning.
	 *
	 * @var int
	 */
	private static $dropped = 0;

	/**
	 * Total DB time in milliseconds.
	 *
	 * @var float
	 */
	public static $db_time = 0.0;

	/**
	 * Number of DB queries.
	 *
	 * @var int
	 */
	public static $db_count = 0;

	/**
	 * Total external HTTP time in milliseconds.
	 *
	 * @var float
	 */
	public static $http_time = 0.0;

	/**
	 * Number of external HTTP requests.
	 *
	 * @var int
	 */
	public static $http_count = 0;

	/**
	 * Self time per component: component => array( time, calls ).
	 *
	 * @var array<string, array{0:float,1:int}>
	 */
	private static $components = array();

	/**
	 * Unique errors keyed by fingerprint.
	 *
	 * @var array<string, array>
	 */
	private static $errors = array();

	/**
	 * Clears all collected data.
	 *
	 * @return void
	 */
	public static function reset() {
		self::$spans      = array();
		self::$span_count = 0;
		self::$dropped    = 0;
		self::$db_time    = 0.0;
		self::$db_count   = 0;
		self::$http_time  = 0.0;
		self::$http_count = 0;
		self::$components = array();
		self::$errors     = array();
	}

	/**
	 * Adds a span.
	 *
	 * @param array $span Span data.
	 * @return void
	 */
	public static function add_span( array $span ) {
		self::$spans[] = $span;
		++self::$span_count;
		if ( self::$span_count >= self::PRUNE_AT ) {
			$result           = self::cap_spans( self::$spans, self::MAX_SPANS );
			self::$spans      = $result['spans'];
			self::$dropped   += $result['dropped'];
			self::$span_count = count( self::$spans );
		}
	}

	/**
	 * Returns the spans capped to MAX_SPANS, ordered by start, and the total number dropped.
	 *
	 * @return array{spans:array[],dropped:int}
	 */
	public static function spans() {
		$result             = self::cap_spans( self::$spans, self::MAX_SPANS );
		$result['dropped'] += self::$dropped;
		return $result;
	}

	/**
	 * Keeps the $max longest spans and returns them ordered by start offset.
	 *
	 * @param array[] $spans Spans with 'duration' and 'start' keys.
	 * @param int     $max   Maximum number of spans to keep.
	 * @return array{spans:array[],dropped:int}
	 */
	public static function cap_spans( array $spans, $max ) {
		$total   = count( $spans );
		$dropped = 0;

		if ( $total > $max ) {
			usort(
				$spans,
				static function ( $a, $b ) {
					if ( $a['duration'] === $b['duration'] ) {
						return $a['start'] <=> $b['start'];
					}
					return $b['duration'] <=> $a['duration'];
				}
			);
			$spans   = array_slice( $spans, 0, $max );
			$dropped = $total - $max;
		}

		usort(
			$spans,
			static function ( $a, $b ) {
				return $a['start'] <=> $b['start'];
			}
		);

		return array(
			'spans'   => $spans,
			'dropped' => $dropped,
		);
	}

	/**
	 * Adds self time for a component.
	 *
	 * @param string $component Component.
	 * @param float  $time      Milliseconds.
	 * @param int    $calls     Number of callback invocations.
	 * @return void
	 */
	public static function add_component_time( $component, $time, $calls = 1 ) {
		if ( isset( self::$components[ $component ] ) ) {
			self::$components[ $component ][0] += $time;
			self::$components[ $component ][1] += $calls;
		} else {
			self::$components[ $component ] = array( $time, $calls );
		}
	}

	/**
	 * Returns the per-component aggregate.
	 *
	 * @return array<string, array{0:float,1:int}>
	 */
	public static function components() {
		return self::$components;
	}

	/**
	 * Records an error once per unique level, message, file and line.
	 *
	 * @param array $error Keys: level, message, file, line, component.
	 * @return bool True when it was stored.
	 */
	public static function add_error( array $error ) {
		$key = $error['level'] . '|' . $error['message'] . '|' . $error['file'] . '|' . $error['line'];
		if ( isset( self::$errors[ $key ] ) || count( self::$errors ) >= self::MAX_ERRORS ) {
			return false;
		}
		self::$errors[ $key ] = $error;
		return true;
	}

	/**
	 * Returns true when an error was already recorded at the file and line.
	 *
	 * @param string $file File (relative).
	 * @param int    $line Line.
	 * @return bool
	 */
	public static function has_error_at( $file, $line ) {
		foreach ( self::$errors as $error ) {
			if ( $error['file'] === $file && (int) $error['line'] === (int) $line ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Returns the recorded errors.
	 *
	 * @return array[]
	 */
	public static function errors() {
		return array_values( self::$errors );
	}
}
