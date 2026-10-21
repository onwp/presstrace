<?php
/**
 * Tests for PressTrace_Payload.
 *
 * @package PressTrace
 */

use PHPUnit\Framework\TestCase;

class PayloadTest extends TestCase {

	private static function tx() {
		return array(
			'id'             => str_repeat( 'a', 32 ),
			'ts'             => 1792500000123,
			'name'           => 'single-product',
			'type'           => 'frontend',
			'method'         => 'GET',
			'url'            => 'https://shop.example.com/product/album/',
			'status'         => 200,
			'duration'       => 5535.612345,
			'db_time'        => 32.1,
			'db_count'       => 87,
			'http_time'      => 5002.21,
			'http_count'     => 1,
			'memory_peak_mb' => 48.234,
			'sample_rate'    => 1.0,
			'user_logged_in' => false,
		);
	}

	private static function env() {
		return array(
			'php'             => '8.3.12',
			'wp'              => '7.1.3',
			'memory_limit_mb' => 256,
			'object_cache'    => false,
			'db_capture'      => 'dropin',
		);
	}

	public function test_build_matches_contract() {
		$spans = array(
			array( 'kind' => 'db', 'name' => 'wp_options SELECT', 'start' => 86.1234, 'duration' => 0.33, 'component' => 'core', 'sql' => 'SELECT 1', 'rows' => 412, 'error' => '', 'stack' => array(), '_frames' => array( 1 ) ),
			array( 'kind' => 'http', 'name' => 'api.stripe.com POST', 'start' => 191.0, 'duration' => 5002.21, 'component' => 'plugin:pay', 'url' => 'https://api.stripe.com/v1/charges', 'method' => 'POST', 'status' => 200, 'error' => null, 'stack' => array( 'a.php:1 f' ) ),
			array( 'kind' => 'callback', 'name' => 'cb', 'start' => 190.4, 'duration' => 5004.0, 'self' => 1.8, 'component' => 'plugin:pay', 'hook' => 'action:woocommerce_add_to_cart', 'file' => 'wp-content/plugins/pay/p.php:42' ),
			array( 'kind' => 'plugin_load', 'name' => 'woocommerce/woocommerce.php', 'start' => 12.4, 'duration' => 18.9, 'component' => 'plugin:woocommerce' ),
			array( 'kind' => 'theme_load', 'name' => 'storefront', 'start' => 60.2, 'duration' => 4.1, 'component' => 'theme:storefront' ),
			array( 'kind' => 'bogus', 'start' => 1, 'duration' => 1 ),
		);
		$components = array(
			'core'               => array( 99.0, 5 ),
			'plugin:woocommerce' => array( 120.5, 940 ),
			'plugin:pay'         => array( 5004.0, 1 ),
		);
		$errors = array( array( 'level' => 'warning', 'message' => 'Undefined array key "foo"', 'file' => 'wp-content/plugins/demo/demo.php', 'line' => '12', 'component' => 'plugin:demo' ) );

		$payload = PressTrace_Payload::build( '0.1.0', self::env(), self::tx(), $spans, $components, $errors, 3 );

		$this->assertSame( array( 'v', 'agent', 'env', 'transactions' ), array_keys( $payload ) );
		$this->assertSame( 1, $payload['v'] );
		$this->assertSame( array( 'php', 'wp', 'memory_limit_mb', 'object_cache', 'db_capture' ), array_keys( $payload['env'] ) );

		$tx = $payload['transactions'][0];
		$this->assertSame(
			array( 'id', 'ts', 'name', 'type', 'method', 'url', 'status', 'duration', 'db_time', 'db_count', 'http_time', 'http_count', 'memory_peak_mb', 'sample_rate', 'user_logged_in', 'spans', 'components', 'errors', 'dropped_spans' ),
			array_keys( $tx )
		);
		$this->assertSame( 5535.612, $tx['duration'] );
		$this->assertSame( 48.23, $tx['memory_peak_mb'] );
		$this->assertSame( 3, $tx['dropped_spans'] );
		$this->assertCount( 5, $tx['spans'] );

		$db = $tx['spans'][0];
		$this->assertSame( array( 'kind', 'name', 'start', 'duration', 'component', 'sql', 'rows', 'error', 'stack' ), array_keys( $db ) );
		$this->assertSame( 86.123, $db['start'] );
		$this->assertNull( $db['error'] );
		$this->assertNull( $db['stack'] );

		$this->assertSame( array( 'kind', 'name', 'start', 'duration', 'component', 'url', 'method', 'status', 'error', 'stack' ), array_keys( $tx['spans'][1] ) );
		$this->assertSame( array( 'kind', 'name', 'start', 'duration', 'self', 'component', 'hook', 'file' ), array_keys( $tx['spans'][2] ) );
		$this->assertSame( array( 'kind', 'name', 'start', 'duration', 'component' ), array_keys( $tx['spans'][3] ) );

		$this->assertSame( array( 'plugin:pay', 'plugin:woocommerce' ), array_column( $tx['components'], 'component' ) );
		$this->assertSame( 12, $tx['errors'][0]['line'] );

		$json = PressTrace_Payload::encode( $payload );
		$this->assertStringContainsString( '"sample_rate":1.0', $json );
		$this->assertStringContainsString( '"url":"https://shop.example.com/product/album/"', $json );
	}

	public function test_encode_shrinks_oversized_payloads() {
		$spans = array();
		for ( $i = 0; $i < 500; $i++ ) {
			$spans[] = array(
				'kind'      => 'db',
				'name'      => 'x SELECT',
				'start'     => $i,
				'duration'  => 2,
				'component' => 'core',
				'sql'       => str_repeat( 'S', 2000 ),
				'rows'      => 1,
				'error'     => null,
				'stack'     => array_fill( 0, 15, str_repeat( 'f', 200 ) ),
			);
		}
		$payload = PressTrace_Payload::build( '0.1.0', self::env(), self::tx(), $spans, array(), array(), 0 );
		$json    = PressTrace_Payload::encode( $payload );
		$this->assertLessThanOrEqual( PressTrace_Payload::MAX_BYTES, strlen( $json ) );
		$decoded = json_decode( $json, true );
		$this->assertNull( $decoded['transactions'][0]['spans'][0]['stack'] );
	}

	public function test_invalid_utf8_is_substituted() {
		$payload = PressTrace_Payload::build( '0.1.0', self::env(), array_merge( self::tx(), array( 'name' => "bad\xB1" ) ), array(), array(), array(), 0 );
		$this->assertNotFalse( PressTrace_Payload::encode( $payload ) );
	}
}
