<?php
/**
 * PHP error, exception and fatal capture.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Errors', false ) ) {
	return;
}

/**
 * Chains the existing error and exception handlers and records errors with their component.
 */
final class PressTrace_Errors {

	/**
	 * Error types that end the request.
	 */
	const FATAL = E_ERROR | E_PARSE | E_CORE_ERROR | E_COMPILE_ERROR | E_USER_ERROR | E_RECOVERABLE_ERROR;

	/**
	 * Component resolver.
	 *
	 * @var PressTrace_Components
	 */
	private $resolver;

	/**
	 * Handlers that were active before ours, oldest first. Each reclaim adds the handler that replaced ours,
	 * so a handler that chains back to ours still reaches the ones installed before it.
	 *
	 * @var callable[]
	 */
	private $previous_errors = array();

	/**
	 * Previous exception handlers, oldest first.
	 *
	 * @var callable[]
	 */
	private $previous_exceptions = array();

	/**
	 * How many times the error handler is on the call stack (a chained handler can call back into ours).
	 *
	 * @var int
	 */
	private $error_depth = 0;

	/**
	 * How many times the exception handler is on the call stack.
	 *
	 * @var int
	 */
	private $exception_depth = 0;

	/**
	 * Constructor.
	 *
	 * @param PressTrace_Components $resolver Resolver.
	 */
	public function __construct( PressTrace_Components $resolver ) {
		$this->resolver = $resolver;
	}

	/**
	 * Installs the handlers and replays the last error that happened before the agent started.
	 *
	 * Plugins that load later (Query Monitor, for example) may install their own handlers without chaining
	 * to ours, so the handlers are put back on top, chained to theirs, once plugins and the theme are loaded.
	 *
	 * @return void
	 */
	public function install() {
		$this->claim_handlers();

		add_action( 'plugins_loaded', array( $this, 'claim_handlers' ), PHP_INT_MAX );
		add_action( 'after_setup_theme', array( $this, 'claim_handlers' ), PHP_INT_MAX );
		add_action( 'init', array( $this, 'claim_handlers' ), PHP_INT_MAX );

		$last = error_get_last();
		if ( is_array( $last ) && ! ( $last['type'] & self::FATAL ) ) {
			$this->record( self::level( $last['type'] ), $last['message'], $last['file'], $last['line'] );
		}
	}

	/**
	 * Puts our handlers on top when another handler replaced them, chaining to it.
	 *
	 * @return void
	 */
	public function claim_handlers() {
		$own = array( $this, 'handle_error' );

		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_set_error_handler -- chained handler, never changes reporting.
		$current = set_error_handler( $own );
		if ( $current === $own ) {
			restore_error_handler();
		} elseif ( null !== $current && ! in_array( $current, $this->previous_errors, true ) ) {
			$this->previous_errors[] = $current;
		}

		// Only wrap an existing exception handler. Without one, PHP turns the exception into a fatal error,
		// which we read at shutdown, so PHP's default output is left untouched.
		$own     = array( $this, 'handle_exception' );
		$current = set_exception_handler( null );
		if ( null === $current ) {
			return;
		}
		if ( $current !== $own && ! in_array( $current, $this->previous_exceptions, true ) ) {
			$this->previous_exceptions[] = $current;
		}
		set_exception_handler( $own );
	}

	/**
	 * Error handler. Records the error and hands it on unchanged.
	 *
	 * @param int    $errno   Level.
	 * @param string $errstr  Message.
	 * @param string $errfile File.
	 * @param int    $errline Line.
	 * @return mixed False lets PHP's standard handler run; other values come from the previous handler.
	 */
	public function handle_error( $errno, $errstr, $errfile = '', $errline = 0 ) {
		// Depth 0 is the first call; a chained handler that calls back into ours gets the next older handler.
		$depth = $this->error_depth++;

		try {
			// Respect the @ operator and error_reporting().
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.prevent_path_disclosure_error_reporting, WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_error_reporting -- reads the level, never changes it.
			if ( 0 === $depth && PressTrace_Trace::$active && ( error_reporting() & $errno ) ) {
				$this->record( self::level( $errno ), (string) $errstr, (string) $errfile, (int) $errline );
			}

			$index = count( $this->previous_errors ) - 1 - $depth;
			if ( $index >= 0 ) {
				return call_user_func( $this->previous_errors[ $index ], $errno, $errstr, $errfile, $errline );
			}

			// Let PHP's standard handler run as well.
			return false;
		} finally {
			--$this->error_depth;
		}
	}

	/**
	 * Exception handler, installed only when another handler existed. Records and delegates.
	 *
	 * @param Throwable $exception Exception.
	 * @return void
	 */
	public function handle_exception( $exception ) {
		$depth = $this->exception_depth++;
		try {
			if ( 0 === $depth && PressTrace_Trace::$active ) {
				$this->record( $exception instanceof Error ? 'fatal' : 'exception', get_class( $exception ) . ': ' . $exception->getMessage(), $exception->getFile(), $exception->getLine() );
			}
			// A handler that calls back into ours gets the next older one; past the oldest the loop stops.
			$index = count( $this->previous_exceptions ) - 1 - $depth;
			if ( $index >= 0 ) {
				call_user_func( $this->previous_exceptions[ $index ], $exception );
			}
		} finally {
			--$this->exception_depth;
		}
	}

	/**
	 * Records a fatal error or uncaught exception from error_get_last(). Called at shutdown.
	 *
	 * @return void
	 */
	public function capture_fatal() {
		$last = error_get_last();
		if ( ! is_array( $last ) || ! ( $last['type'] & self::FATAL ) ) {
			return;
		}

		$message = (string) $last['message'];
		$level   = 'fatal';

		if ( 0 === strpos( $message, 'Uncaught ' ) ) {
			$message = self::uncaught_message( $message );
			// Engine errors (Error, TypeError, ...) are fatals; Exception subclasses are exceptions.
			$level = self::is_engine_error( $message ) ? 'fatal' : 'exception';
		}

		$file = $this->resolver->relative( $last['file'] );
		// Already recorded by our handlers: an uncaught exception, or an E_USER_ERROR the error handler saw.
		$seen = 'exception' === $level || E_USER_ERROR === (int) $last['type'];
		if ( $seen && PressTrace_Trace::has_error_at( $file, (int) $last['line'] ) ) {
			return;
		}
		$this->record( $level, $message, (string) $last['file'], (int) $last['line'] );
	}

	/**
	 * Shortens "Uncaught Exception: boom in /path/file.php:12\nStack trace:..." to "Exception: boom".
	 *
	 * @param string $message Raw message.
	 * @return string
	 */
	public static function uncaught_message( $message ) {
		$message = substr( $message, strlen( 'Uncaught ' ) );
		$line    = strtok( $message, "\n" );
		$line    = false === $line ? $message : $line;
		return (string) preg_replace( '/ in [^\s]+:\d+$/', '', $line );
	}

	/**
	 * Returns true when "Class: message" names a subclass of Error.
	 *
	 * @param string $message Shortened uncaught message.
	 * @return bool
	 */
	public static function is_engine_error( $message ) {
		$class = strtok( $message, ':' );
		return false !== $class && class_exists( $class, false ) && is_a( $class, 'Error', true );
	}

	/**
	 * Maps a PHP error number to a payload level.
	 *
	 * @param int $errno Error number.
	 * @return string
	 */
	public static function level( $errno ) {
		switch ( $errno ) {
			case E_ERROR:
			case E_PARSE:
			case E_CORE_ERROR:
			case E_COMPILE_ERROR:
				return 'fatal';
			case E_USER_ERROR:
			case E_RECOVERABLE_ERROR:
				return 'error';
			case E_WARNING:
			case E_USER_WARNING:
			case E_CORE_WARNING:
			case E_COMPILE_WARNING:
				return 'warning';
			case E_DEPRECATED:
			case E_USER_DEPRECATED:
				return 'deprecated';
			default:
				return 'notice';
		}
	}

	/**
	 * Stores an error.
	 *
	 * @param string $level   Level.
	 * @param string $message Message.
	 * @param string $file    Absolute file.
	 * @param int    $line    Line.
	 * @return void
	 */
	private function record( $level, $message, $file, $line ) {
		$message = str_replace( array( ABSPATH, PressTrace_Components::normalize( ABSPATH ) ), '', (string) $message );
		if ( strlen( $message ) > 1000 ) {
			$message = substr( $message, 0, 1000 );
		}
		PressTrace_Trace::add_error(
			array(
				'level'     => $level,
				'message'   => $message,
				'file'      => '' === $file ? '' : $this->resolver->relative( $file ),
				'line'      => (int) $line,
				'component' => '' === $file ? 'unknown' : $this->resolver->from_file( $file ),
			)
		);
	}
}
