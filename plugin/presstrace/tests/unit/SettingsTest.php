<?php
/**
 * Tests for PressTrace_Settings.
 *
 * @package PressTrace
 */

use PHPUnit\Framework\TestCase;

class SettingsTest extends TestCase {

	const KEY = 'pt_0123456789abcdef0123456789abcdef01234567';

	public function test_sanitize_full_input() {
		$out = PressTrace_Settings::sanitize(
			array(
				'app_url'     => ' https://APM.example.com/sub/ ',
				'site_key'    => strtoupper( self::KEY ),
				'enabled'     => '1',
				'window'      => '4h',
				'sample_rate' => '0,25',
			),
			array(),
			1000
		);
		$this->assertSame(
			array(
				'app_url'       => 'https://apm.example.com/sub',
				'site_key'      => self::KEY,
				'enabled'       => true,
				'window'        => '4h',
				'enabled_until' => 1000 + 4 * 3600,
				'sample_rate'   => 0.25,
			),
			$out
		);
	}

	public function test_empty_key_keeps_previous_and_bad_values_fall_back() {
		$previous = array_merge( PressTrace_Settings::defaults(), array( 'site_key' => self::KEY, 'app_url' => 'https://a.test' ) );
		$out      = PressTrace_Settings::sanitize(
			array(
				'app_url'     => 'javascript:alert(1)',
				'site_key'    => '',
				'window'      => '99h',
				'sample_rate' => '7',
			),
			$previous,
			1000
		);
		$this->assertSame( self::KEY, $out['site_key'] );
		$this->assertSame( '', $out['app_url'] );
		$this->assertSame( '2h', $out['window'] );
		$this->assertSame( 1.0, $out['sample_rate'] );
		$this->assertFalse( $out['enabled'] );
		$this->assertSame( 0, $out['enabled_until'] );
	}

	public function test_invalid_key_keeps_previous() {
		$out = PressTrace_Settings::sanitize( array( 'site_key' => 'pt_short' ), array( 'site_key' => self::KEY ), 1 );
		$this->assertSame( self::KEY, $out['site_key'] );
	}

	public function test_always_window_has_no_expiry() {
		$out = PressTrace_Settings::sanitize( array( 'enabled' => '1', 'window' => 'always' ), array(), 1000 );
		$this->assertSame( 0, $out['enabled_until'] );
		$this->assertTrue( PressTrace_Settings::is_monitoring( $out, PHP_INT_MAX ) );
	}

	public function test_app_url_rules() {
		$this->assertSame( 'http://localhost:3002', PressTrace_Settings::clean_app_url( 'http://localhost:3002/' ) );
		$this->assertSame( '', PressTrace_Settings::clean_app_url( 'ftp://x.test' ) );
		$this->assertSame( '', PressTrace_Settings::clean_app_url( 'https://u:p@x.test' ) );
		$this->assertSame( '', PressTrace_Settings::clean_app_url( 'https://x.test/"onload' ) );
		$this->assertSame( '', PressTrace_Settings::clean_app_url( array() ) );
	}

	public function test_monitoring_window() {
		$settings = array( 'enabled' => true, 'window' => '2h', 'enabled_until' => 2000 );
		$this->assertTrue( PressTrace_Settings::is_monitoring( $settings, 1999 ) );
		$this->assertFalse( PressTrace_Settings::is_monitoring( $settings, 2000 ) );
		$settings['enabled'] = false;
		$this->assertFalse( PressTrace_Settings::is_monitoring( $settings, 1 ) );
	}

	public function test_sampling() {
		$this->assertTrue( PressTrace_Settings::is_sampled( 1.0, 0.999 ) );
		$this->assertFalse( PressTrace_Settings::is_sampled( 0.0, 0.0 ) );
		$this->assertTrue( PressTrace_Settings::is_sampled( 0.5, 0.49 ) );
		$this->assertFalse( PressTrace_Settings::is_sampled( 0.5, 0.5 ) );
	}

	public function test_constants_override() {
		$settings = PressTrace_Settings::apply_constants(
			PressTrace_Settings::defaults(),
			array(
				'app_url'     => 'https://fleet.test/',
				'site_key'    => self::KEY,
				'sample_rate' => 0.1,
				'always_on'   => true,
			)
		);
		$this->assertSame( 'https://fleet.test', $settings['app_url'] );
		$this->assertTrue( PressTrace_Settings::is_configured( $settings ) );
		$this->assertSame( 0.1, $settings['sample_rate'] );
		$this->assertTrue( PressTrace_Settings::is_monitoring( $settings, time() ) );
	}

	public function test_mask() {
		$this->assertSame( 'pt_********4567', PressTrace_Settings::mask_key( self::KEY ) );
		$this->assertSame( '', PressTrace_Settings::mask_key( '' ) );
	}
}
