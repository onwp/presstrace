<?php
/**
 * SQL helpers: truncation and short span names.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Sql', false ) ) {
	return;
}

/**
 * Pure helpers for SQL strings.
 */
final class PressTrace_Sql {

	/**
	 * Maximum SQL length sent to the app.
	 */
	const MAX_LENGTH = 2000;

	/**
	 * Truncates SQL to the payload limit without splitting a multibyte character.
	 *
	 * @param string $sql SQL text.
	 * @param int    $max Maximum length in bytes.
	 * @return string
	 */
	public static function truncate( $sql, $max = self::MAX_LENGTH ) {
		$sql = trim( (string) $sql );
		if ( strlen( $sql ) <= $max ) {
			return $sql;
		}

		$cut = substr( $sql, 0, $max );

		// Drop a trailing partial UTF-8 sequence so the payload stays valid JSON.
		if ( function_exists( 'mb_check_encoding' ) ) {
			$guard = 0;
			while ( '' !== $cut && ! mb_check_encoding( $cut, 'UTF-8' ) && $guard < 4 ) {
				$cut = substr( $cut, 0, -1 );
				++$guard;
			}
		}

		return $cut;
	}

	/**
	 * Builds a short span name such as "wp_options SELECT".
	 *
	 * @param string $sql SQL text.
	 * @return string
	 */
	public static function name( $sql ) {
		$sql = ltrim( (string) $sql, " \t\n\r\0\x0B(" );
		// Skip leading comments like /* ... */.
		while ( 0 === strpos( $sql, '/*' ) ) {
			$end = strpos( $sql, '*/' );
			if ( false === $end ) {
				break;
			}
			$sql = ltrim( substr( $sql, $end + 2 ), " \t\n\r\0\x0B(" );
		}

		if ( ! preg_match( '/^([a-z]+)/i', $sql, $m ) ) {
			return 'QUERY';
		}

		$verb  = strtoupper( $m[1] );
		$table = null;
		$ident = '`?([a-z0-9_$]+(?:`?\.`?[a-z0-9_$]+)?)`?';

		switch ( $verb ) {
			case 'SELECT':
			case 'DELETE':
				if ( preg_match( '/\bFROM\s+' . $ident . '/i', $sql, $t ) ) {
					$table = $t[1];
				}
				break;
			case 'INSERT':
			case 'REPLACE':
				if ( preg_match( '/^\w+(?:\s+(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY|IGNORE))*\s+(?:INTO\s+)?' . $ident . '/i', $sql, $t ) ) {
					$table = $t[1];
				}
				break;
			case 'UPDATE':
				if ( preg_match( '/^UPDATE(?:\s+(?:LOW_PRIORITY|IGNORE))*\s+' . $ident . '/i', $sql, $t ) ) {
					$table = $t[1];
				}
				break;
			case 'SHOW':
			case 'DESCRIBE':
			case 'SET':
			case 'CREATE':
			case 'ALTER':
			case 'DROP':
			case 'TRUNCATE':
				if ( preg_match( '/^(\w+\s+\w+)/', $sql, $t ) ) {
					return strtoupper( preg_replace( '/\s+/', ' ', $t[1] ) );
				}
				break;
		}

		if ( null === $table ) {
			return $verb;
		}

		return str_replace( '`', '', $table ) . ' ' . $verb;
	}
}
