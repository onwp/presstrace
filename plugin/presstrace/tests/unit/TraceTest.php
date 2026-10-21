<?php
/**
 * Tests for PressTrace_Trace.
 *
 * @package PressTrace
 */

use PHPUnit\Framework\TestCase;

class TraceTest extends TestCase {

	protected function setUp(): void {
		PressTrace_Trace::reset();
	}

	private static function span( $start, $duration ) {
		return array(
			'kind'     => 'db',
			'start'    => (float) $start,
			'duration' => (float) $duration,
		);
	}

	public function test_cap_keeps_longest_and_orders_by_start() {
		$spans  = array( self::span( 1, 5 ), self::span( 2, 1 ), self::span( 3, 9 ), self::span( 4, 2 ) );
		$result = PressTrace_Trace::cap_spans( $spans, 2 );
		$this->assertSame( 2, $result['dropped'] );
		$this->assertSame( array( 1.0, 3.0 ), array_column( $result['spans'], 'start' ) );
	}

	public function test_cap_below_limit_only_sorts() {
		$result = PressTrace_Trace::cap_spans( array( self::span( 5, 1 ), self::span( 1, 1 ) ), 10 );
		$this->assertSame( 0, $result['dropped'] );
		$this->assertSame( array( 1.0, 5.0 ), array_column( $result['spans'], 'start' ) );
	}

	public function test_store_prunes_and_counts_dropped() {
		for ( $i = 0; $i < 1203; $i++ ) {
			PressTrace_Trace::add_span( self::span( $i, $i % 97 ) );
		}
		$result = PressTrace_Trace::spans();
		$this->assertCount( PressTrace_Trace::MAX_SPANS, $result['spans'] );
		$this->assertSame( 1203 - PressTrace_Trace::MAX_SPANS, $result['dropped'] );
		$all = array();
		for ( $i = 0; $i < 1203; $i++ ) {
			$all[] = (float) ( $i % 97 );
		}
		rsort( $all );
		$this->assertSame( $all[ PressTrace_Trace::MAX_SPANS - 1 ], min( array_column( $result['spans'], 'duration' ) ) );
	}

	public function test_errors_are_deduplicated_and_capped() {
		$error = array( 'level' => 'warning', 'message' => 'm', 'file' => 'a.php', 'line' => 1, 'component' => 'plugin:a' );
		$this->assertTrue( PressTrace_Trace::add_error( $error ) );
		$this->assertFalse( PressTrace_Trace::add_error( $error ) );
		for ( $i = 2; $i < 100; $i++ ) {
			$error['line'] = $i;
			PressTrace_Trace::add_error( $error );
		}
		$this->assertCount( PressTrace_Trace::MAX_ERRORS, PressTrace_Trace::errors() );
		$this->assertTrue( PressTrace_Trace::has_error_at( 'a.php', 1 ) );
		$this->assertFalse( PressTrace_Trace::has_error_at( 'a.php', 99 ) );
	}

	public function test_component_time_aggregates() {
		PressTrace_Trace::add_component_time( 'plugin:a', 1.5, 1 );
		PressTrace_Trace::add_component_time( 'plugin:a', 2.0, 1 );
		PressTrace_Trace::add_component_time( 'plugin:a', 10.0, 0 );
		$this->assertSame( array( 'plugin:a' => array( 13.5, 2 ) ), PressTrace_Trace::components() );
	}
}
