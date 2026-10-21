<?php
/**
 * Database query capture: the db.php drop-in path and the two fallbacks.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Db_Capture', false ) ) {
	return;
}

/**
 * Records queries into PressTrace_Trace.
 *
 * Modes: "dropin" (our wpdb subclass times query()), "log_query" (a foreign db.php with SAVEQUERIES, such as
 * Query Monitor, feeds the log_query_custom_data filter) and "query_filter" (count only).
 */
final class PressTrace_Db_Capture {

	/**
	 * Whether the drop-in records queries. Starts true when the drop-in loads (to buffer the queries that run
	 * before the agent decides), and is switched off unless the agent claims the request.
	 *
	 * @var bool
	 */
	public static $recording = false;

	/**
	 * Nesting depth of query() calls (charset checks can run queries inside a query).
	 *
	 * @var int
	 */
	public static $depth = 0;

	/**
	 * Whether the agent has claimed the recording for this request.
	 *
	 * @var bool
	 */
	private static $claimed = false;

	/**
	 * Active mode.
	 *
	 * @var string
	 */
	private static $mode = 'query_filter';

	/**
	 * In log_query mode: the last query span, completed with rows and error when the next query starts.
	 *
	 * @var array|null
	 */
	private static $pending = null;

	/**
	 * Cache: class name => whether it is wpdb or a subclass.
	 *
	 * @var array<string, bool>
	 */
	private static $wpdb_classes = array();

	/**
	 * Called by the db.php drop-in right after it loads.
	 *
	 * @return void
	 */
	public static function boot_dropin() {
		self::$mode      = 'dropin';
		self::$recording = true;
		PressTrace_Clock::init();
		// When nothing claims the request (plugin inactive, agent dormant), stop buffering.
		add_action( 'muplugins_loaded', array( __CLASS__, 'release_unclaimed' ), PHP_INT_MAX );
	}

	/**
	 * Stops recording when the agent did not claim the request.
	 *
	 * @return void
	 */
	public static function release_unclaimed() {
		if ( ! self::$claimed ) {
			self::stop( true );
		}
	}

	/**
	 * Starts capture for a traced request and picks the mode.
	 *
	 * @return string The mode in use.
	 */
	public static function claim() {
		self::$claimed = true;

		if ( isset( $GLOBALS['wpdb'] ) && $GLOBALS['wpdb'] instanceof PressTrace_DB ) {
			self::$mode      = 'dropin';
			self::$recording = true;
			return self::$mode;
		}

		self::$recording = false;
		if ( defined( 'SAVEQUERIES' ) && SAVEQUERIES ) {
			self::$mode = 'log_query';
			add_filter( 'log_query_custom_data', array( __CLASS__, 'on_log_query' ), PHP_INT_MAX, 5 );
			add_filter( 'query', array( __CLASS__, 'on_next_query' ), PHP_INT_MAX );
		} else {
			self::$mode = 'query_filter';
			add_filter( 'query', array( __CLASS__, 'on_query_filter' ), PHP_INT_MAX );
		}
		return self::$mode;
	}

	/**
	 * Stops recording.
	 *
	 * @param bool $discard Whether to discard what was buffered.
	 * @return void
	 */
	public static function stop( $discard ) {
		self::$recording = false;
		remove_filter( 'log_query_custom_data', array( __CLASS__, 'on_log_query' ), PHP_INT_MAX );
		remove_filter( 'query', array( __CLASS__, 'on_next_query' ), PHP_INT_MAX );
		remove_filter( 'query', array( __CLASS__, 'on_query_filter' ), PHP_INT_MAX );
		if ( $discard ) {
			self::$pending = null;
			PressTrace_Trace::reset();
		} else {
			self::flush_pending();
		}
	}

	/**
	 * Returns the active mode.
	 *
	 * @return string
	 */
	public static function mode() {
		return self::$mode;
	}

	/**
	 * Records one query from the drop-in.
	 *
	 * @param wpdb     $db     The database object.
	 * @param string   $sql    SQL text.
	 * @param int      $start  hrtime at start.
	 * @param int      $end    hrtime at end.
	 * @param int|bool $result Return value of wpdb::query().
	 * @return void
	 */
	public static function record_dropin( $db, $sql, $start, $end, $result ) {
		$span = self::span( $sql, PressTrace_Clock::from_hr( $start ), ( $end - $start ) / 1e6 );
		if ( false === $result ) {
			$span['error'] = '' !== (string) $db->last_error ? (string) $db->last_error : 'Query failed';
		} elseif ( is_int( $result ) ) {
			$span['rows'] = $result;
		}
		PressTrace_Trace::add_span( $span );
	}

	/**
	 * Records a query reported through log_query_custom_data (foreign db.php with SAVEQUERIES).
	 * It fires right after mysqli_query(), before rows are fetched, so the span waits for the next query.
	 *
	 * @param array  $data       Custom data, returned unchanged.
	 * @param string $sql        SQL.
	 * @param float  $time       Query time in seconds.
	 * @param string $callstack  Core callstack summary (unused, we take our own frames).
	 * @param float  $start_time Query start as Unix timestamp.
	 * @return array
	 */
	public static function on_log_query( $data, $sql, $time, $callstack, $start_time ) {
		if ( PressTrace_Trace::$active ) {
			self::flush_pending();
			self::$pending = self::span( (string) $sql, PressTrace_Clock::from_timestamp( (float) $start_time ), (float) $time * 1000 );
		}
		return $data;
	}

	/**
	 * In log_query mode: the previous query is complete when the next one starts, so read its result now.
	 *
	 * @param string $sql SQL, returned unchanged.
	 * @return string
	 */
	public static function on_next_query( $sql ) {
		if ( null !== self::$pending ) {
			self::flush_pending();
		}
		return $sql;
	}

	/**
	 * Completes the pending log_query span from the wpdb state and stores it.
	 *
	 * @return void
	 */
	public static function flush_pending() {
		if ( null === self::$pending ) {
			return;
		}
		$span          = self::$pending;
		self::$pending = null;

		$db = isset( $GLOBALS['wpdb'] ) ? $GLOBALS['wpdb'] : null;
		if ( is_object( $db ) ) {
			if ( ! empty( $db->last_error ) ) {
				$span['error'] = (string) $db->last_error;
			} elseif ( preg_match( '/^\s*(insert|delete|update|replace)\s/i', $span['sql'] ) ) {
				$span['rows'] = (int) $db->rows_affected;
			} elseif ( ! preg_match( '/^\s*(create|alter|truncate|drop)\s/i', $span['sql'] ) ) {
				$span['rows'] = (int) $db->num_rows;
			}
		}
		PressTrace_Trace::add_span( $span );
	}

	/**
	 * Counts a query when no timing source exists.
	 *
	 * @param string $sql SQL.
	 * @return string
	 */
	public static function on_query_filter( $sql ) {
		if ( PressTrace_Trace::$active ) {
			++PressTrace_Trace::$db_count;
		}
		return $sql;
	}

	/**
	 * Builds a query span, updates the totals and captures the caller frames.
	 *
	 * @param string $sql      SQL.
	 * @param float  $start    Start offset in ms.
	 * @param float  $duration Duration in ms.
	 * @return array
	 */
	private static function span( $sql, $start, $duration ) {
		++PressTrace_Trace::$db_count;
		PressTrace_Trace::$db_time += $duration;

		return array(
			'kind'     => 'db',
			'name'     => PressTrace_Sql::name( $sql ),
			'start'    => $start,
			'duration' => $duration,
			'sql'      => PressTrace_Sql::truncate( $sql ),
			'rows'     => null,
			'error'    => null,
			'_frames'  => self::caller_frames(),
			'_context' => class_exists( 'PressTrace_Callback', false ) ? PressTrace_Callback::current_component() : null,
		);
	}

	/**
	 * Returns the backtrace starting at the code that called into wpdb.
	 *
	 * Frames inside wpdb (and subclasses such as Query Monitor's QM_DB) are dropped: the first kept frame's
	 * file is the caller of the outermost wpdb method.
	 *
	 * @return array[]
	 */
	private static function caller_frames() {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_debug_backtrace -- caller attribution.
		$frames = debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS, 40 );

		$outer = 0;
		foreach ( $frames as $i => $frame ) {
			if ( isset( $frame['class'] ) && self::is_wpdb_class( $frame['class'] ) ) {
				$outer = $i;
			}
		}

		$slim  = array();
		$count = count( $frames );
		for ( $i = $outer; $i < $count; $i++ ) {
			$frame  = $frames[ $i ];
			$slim[] = array(
				'file'     => isset( $frame['file'] ) ? $frame['file'] : '',
				'line'     => isset( $frame['line'] ) ? $frame['line'] : 0,
				'function' => isset( $frame['function'] ) ? $frame['function'] : '',
				'class'    => isset( $frame['class'] ) ? $frame['class'] : null,
				'type'     => isset( $frame['type'] ) ? $frame['type'] : null,
			);
		}
		return $slim;
	}

	/**
	 * Returns true for wpdb and its subclasses.
	 *
	 * @param string $class Class name.
	 * @return bool
	 */
	private static function is_wpdb_class( $class ) {
		if ( ! isset( self::$wpdb_classes[ $class ] ) ) {
			self::$wpdb_classes[ $class ] = 'wpdb' === $class || is_subclass_of( $class, 'wpdb' );
		}
		return self::$wpdb_classes[ $class ];
	}
}
