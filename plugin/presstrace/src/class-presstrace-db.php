<?php
/**
 * The wpdb subclass installed by the PressTrace db.php drop-in.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_DB', false ) || ! class_exists( 'wpdb', false ) ) {
	return;
}

/**
 * Times every query. When the agent is dormant the only cost is one static property check per query.
 */
class PressTrace_DB extends wpdb {

	/**
	 * Performs a database query and records its duration, rows and error.
	 *
	 * @param string $query Database query.
	 * @return int|bool
	 */
	public function query( $query ) {
		if ( ! PressTrace_Db_Capture::$recording || PressTrace_Db_Capture::$depth > 0 || ! $this->ready ) {
			return parent::query( $query );
		}

		++PressTrace_Db_Capture::$depth;
		$start = hrtime( true );
		try {
			$result = parent::query( $query );
		} finally {
			--PressTrace_Db_Capture::$depth;
		}
		$end = hrtime( true );

		if ( PressTrace_Db_Capture::$recording ) {
			PressTrace_Db_Capture::record_dropin( $this, (string) $query, $start, $end, $result );
		}

		return $result;
	}
}
