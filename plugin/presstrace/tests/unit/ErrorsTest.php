<?php
/**
 * Tests for the pure helpers of PressTrace_Errors.
 *
 * @package PressTrace
 */

use PHPUnit\Framework\TestCase;

class ErrorsTest extends TestCase {

	public function test_levels() {
		$this->assertSame( 'warning', PressTrace_Errors::level( E_WARNING ) );
		$this->assertSame( 'warning', PressTrace_Errors::level( E_USER_WARNING ) );
		$this->assertSame( 'notice', PressTrace_Errors::level( E_NOTICE ) );
		$this->assertSame( 'deprecated', PressTrace_Errors::level( E_USER_DEPRECATED ) );
		$this->assertSame( 'error', PressTrace_Errors::level( E_RECOVERABLE_ERROR ) );
		$this->assertSame( 'fatal', PressTrace_Errors::level( E_ERROR ) );
	}

	public function test_uncaught_message() {
		$raw = "Uncaught RuntimeException: boom in /srv/www/wp-content/plugins/a/a.php:12\nStack trace:\n#0 {main}\n  thrown";
		$this->assertSame( 'RuntimeException: boom', PressTrace_Errors::uncaught_message( $raw ) );
	}

	public function test_engine_errors_are_fatal() {
		$this->assertTrue( PressTrace_Errors::is_engine_error( 'Error: Call to undefined function x()' ) );
		$this->assertTrue( PressTrace_Errors::is_engine_error( 'TypeError: bad' ) );
		$this->assertFalse( PressTrace_Errors::is_engine_error( 'RuntimeException: boom' ) );
		$this->assertFalse( PressTrace_Errors::is_engine_error( 'Missing_Class: x' ) );
	}

	public function test_chained_handlers_all_run_once_without_recursion() {
		$calls = array();
		$a     = static function () use ( &$calls ) {
			$calls[] = 'a';
			return true;
		};
		set_error_handler( $a );
		$errors = new PressTrace_Errors( PressTrace_Components::from_environment( '/srv/www/wp-content/plugins/presstrace' ) );
		$errors->claim_handlers();

		// A later plugin installs a handler that chains to ours; the next reclaim puts ours back on top.
		$ours = null;
		$b    = static function ( $no, $str, $file, $line ) use ( &$calls, &$ours ) {
			$calls[] = 'b';
			return call_user_func( $ours, $no, $str, $file, $line );
		};
		$ours = set_error_handler( $b );
		$errors->claim_handlers();

		try {
			trigger_error( 'chained', E_USER_NOTICE ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_trigger_error
		} finally {
			// Four handlers were pushed: a, ours, b, ours.
			restore_error_handler();
			restore_error_handler();
			restore_error_handler();
			restore_error_handler();
		}
		$this->assertSame( array( 'b', 'a' ), $calls );
	}
}
