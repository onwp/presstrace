<?php
/**
 * Builds and encodes the ingest payload (format v1, see docs-site/reference/payload.md).
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Payload', false ) ) {
	return;
}

/**
 * Pure payload assembly.
 */
final class PressTrace_Payload {

	/**
	 * Payload format version.
	 */
	const VERSION = 1;

	/**
	 * The app rejects bodies above 2 MB decompressed; stay below with a margin.
	 */
	const MAX_BYTES = 1900000;

	/**
	 * Field order per span kind. Values not present default to null.
	 *
	 * @var array<string, string[]>
	 */
	const SPAN_FIELDS = array(
		'db'          => array( 'kind', 'name', 'start', 'duration', 'component', 'sql', 'rows', 'error', 'stack' ),
		'http'        => array( 'kind', 'name', 'start', 'duration', 'component', 'url', 'method', 'status', 'error', 'stack' ),
		'callback'    => array( 'kind', 'name', 'start', 'duration', 'self', 'component', 'hook', 'file' ),
		'plugin_load' => array( 'kind', 'name', 'start', 'duration', 'component' ),
		'theme_load'  => array( 'kind', 'name', 'start', 'duration', 'component' ),
	);

	/**
	 * Builds the payload array.
	 *
	 * @param string $agent      Agent version.
	 * @param array  $env        Keys: php, wp, memory_limit_mb, object_cache, db_capture.
	 * @param array  $tx         Transaction fields without spans, components, errors and dropped_spans.
	 * @param array  $spans      Spans (extra keys are ignored).
	 * @param array  $components Map component => array( time, calls ).
	 * @param array  $errors     Errors.
	 * @param int    $dropped    Number of spans dropped by the cap.
	 * @return array
	 */
	public static function build( $agent, array $env, array $tx, array $spans, array $components, array $errors, $dropped ) {
		$transaction = array(
			'id'             => (string) $tx['id'],
			'ts'             => (int) $tx['ts'],
			'name'           => (string) $tx['name'],
			'type'           => (string) $tx['type'],
			'method'         => (string) $tx['method'],
			'url'            => (string) $tx['url'],
			'status'         => (int) $tx['status'],
			'duration'       => self::ms( $tx['duration'] ),
			'db_time'        => self::ms( $tx['db_time'] ),
			'db_count'       => (int) $tx['db_count'],
			'http_time'      => self::ms( $tx['http_time'] ),
			'http_count'     => (int) $tx['http_count'],
			'memory_peak_mb' => round( (float) $tx['memory_peak_mb'], 2 ),
			'sample_rate'    => (float) $tx['sample_rate'],
			'user_logged_in' => (bool) $tx['user_logged_in'],
			'spans'          => array(),
			'components'     => self::components( $components ),
			'errors'         => array(),
			'dropped_spans'  => (int) $dropped,
		);

		foreach ( $spans as $span ) {
			$clean = self::span( $span );
			if ( null !== $clean ) {
				$transaction['spans'][] = $clean;
			}
		}

		foreach ( $errors as $error ) {
			$transaction['errors'][] = array(
				'level'     => (string) $error['level'],
				'message'   => (string) $error['message'],
				'file'      => (string) $error['file'],
				'line'      => (int) $error['line'],
				'component' => (string) $error['component'],
			);
		}

		return array(
			'v'            => self::VERSION,
			'agent'        => (string) $agent,
			'env'          => array(
				'php'             => (string) $env['php'],
				'wp'              => (string) $env['wp'],
				'memory_limit_mb' => (int) $env['memory_limit_mb'],
				'object_cache'    => (bool) $env['object_cache'],
				'db_capture'      => (string) $env['db_capture'],
			),
			'transactions' => array( $transaction ),
		);
	}

	/**
	 * Normalises one span to the documented fields for its kind.
	 *
	 * @param array $span Span.
	 * @return array|null Null for an unknown kind.
	 */
	public static function span( array $span ) {
		$kind = isset( $span['kind'] ) ? $span['kind'] : '';
		if ( ! isset( self::SPAN_FIELDS[ $kind ] ) ) {
			return null;
		}

		$out = array();
		foreach ( self::SPAN_FIELDS[ $kind ] as $field ) {
			$value = array_key_exists( $field, $span ) ? $span[ $field ] : null;
			switch ( $field ) {
				case 'start':
				case 'duration':
				case 'self':
					$value = self::ms( $value );
					break;
				case 'rows':
				case 'status':
					$value = ( null === $value || '' === $value ) ? null : (int) $value;
					break;
				case 'error':
					$value = ( null === $value || '' === $value ) ? null : (string) $value;
					break;
				case 'stack':
					$value = ( is_array( $value ) && array() !== $value ) ? array_values( array_map( 'strval', array_slice( $value, 0, 15 ) ) ) : null;
					break;
				case 'sql':
					$value = PressTrace_Sql::truncate( (string) $value );
					break;
				default:
					$value = null === $value ? ( 'component' === $field ? 'unknown' : '' ) : (string) $value;
			}
			$out[ $field ] = $value;
		}
		return $out;
	}

	/**
	 * Converts the component aggregate into the payload list, excluding core, longest first.
	 *
	 * @param array $components Map component => array( time, calls ).
	 * @return array[]
	 */
	public static function components( array $components ) {
		$out = array();
		foreach ( $components as $component => $agg ) {
			if ( 'core' === $component ) {
				continue;
			}
			$out[] = array(
				'component' => (string) $component,
				'time'      => self::ms( $agg[0] ),
				'calls'     => (int) $agg[1],
			);
		}
		usort(
			$out,
			static function ( $a, $b ) {
				return $b['time'] <=> $a['time'];
			}
		);
		return $out;
	}

	/**
	 * Encodes the payload as JSON, shrinking it when it exceeds the size limit.
	 *
	 * @param array $payload Payload.
	 * @return string|false
	 */
	public static function encode( array $payload ) {
		$flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRESERVE_ZERO_FRACTION;
		$json  = json_encode( $payload, $flags ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- runs in pure context and at shutdown.

		$step = 0;
		$size = false === $json ? 0 : strlen( $json );
		while ( false !== $json && $size > self::MAX_BYTES && $step < 8 ) {
			$tx = &$payload['transactions'][0];
			if ( 0 === $step ) {
				foreach ( $tx['spans'] as &$span ) {
					if ( array_key_exists( 'stack', $span ) ) {
						$span['stack'] = null;
					}
				}
				unset( $span );
			} elseif ( 1 === $step ) {
				foreach ( $tx['spans'] as &$span ) {
					if ( isset( $span['sql'] ) ) {
						$span['sql'] = PressTrace_Sql::truncate( $span['sql'], 300 );
					}
				}
				unset( $span );
			} else {
				$keep                 = (int) floor( count( $tx['spans'] ) / 2 );
				$capped               = PressTrace_Trace::cap_spans( $tx['spans'], $keep );
				$tx['spans']          = $capped['spans'];
				$tx['dropped_spans'] += $capped['dropped'];
			}
			unset( $tx );
			++$step;
			$json = json_encode( $payload, $flags ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode
			$size = false === $json ? 0 : strlen( $json );
		}

		return $json;
	}

	/**
	 * Rounds milliseconds to three decimals.
	 *
	 * @param mixed $value Milliseconds.
	 * @return float
	 */
	public static function ms( $value ) {
		return round( max( 0.0, (float) $value ), 3 );
	}
}
