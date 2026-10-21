<?php
/**
 * Tests for PressTrace_Sql.
 *
 * @package PressTrace
 */

use PHPUnit\Framework\TestCase;

class SqlTest extends TestCase {

	public function test_truncate_limits_length() {
		$sql = 'SELECT ' . str_repeat( 'a', 5000 );
		$this->assertSame( 2000, strlen( PressTrace_Sql::truncate( $sql ) ) );
		$this->assertSame( 'SELECT 1', PressTrace_Sql::truncate( "  SELECT 1\n" ) );
	}

	public function test_truncate_keeps_utf8_valid() {
		$sql = str_repeat( 'a', 1999 ) . 'ş' . 'b';
		$out = PressTrace_Sql::truncate( $sql );
		$this->assertTrue( mb_check_encoding( $out, 'UTF-8' ) );
		$this->assertSame( 1999, strlen( $out ) );
	}

	/**
	 * @dataProvider names
	 */
	public function test_name( $sql, $expected ) {
		$this->assertSame( $expected, PressTrace_Sql::name( $sql ) );
	}

	public function names() {
		return array(
			array( "SELECT option_name, option_value FROM wp_options WHERE autoload = 'yes'", 'wp_options SELECT' ),
			array( 'select * from `wp_posts` p join wp_postmeta m', 'wp_posts SELECT' ),
			array( 'SELECT SQL_CALC_FOUND_ROWS wp_posts.ID FROM wp_posts WHERE 1=1', 'wp_posts SELECT' ),
			array( "INSERT INTO `wp_options` (`option_name`) VALUES ('x')", 'wp_options INSERT' ),
			array( 'INSERT IGNORE INTO wp_wc_sessions VALUES (1)', 'wp_wc_sessions INSERT' ),
			array( 'REPLACE INTO wp_x VALUES (1)', 'wp_x REPLACE' ),
			array( "UPDATE `wp_options` SET `option_value` = '1'", 'wp_options UPDATE' ),
			array( 'DELETE FROM wp_options WHERE 1', 'wp_options DELETE' ),
			array( 'SHOW FULL COLUMNS FROM `wp_options`', 'SHOW FULL' ),
			array( 'SELECT SLEEP(0.3)', 'SELECT' ),
			array( '/* comment */ SELECT ID FROM db.wp_posts', 'db.wp_posts SELECT' ),
			array( '(SELECT 1 FROM wp_a) UNION (SELECT 2 FROM wp_b)', 'wp_a SELECT' ),
			array( '', 'QUERY' ),
		);
	}
}
