<?php
/**
 * Callables used by the component tests.
 *
 * @package PressTrace
 */

/**
 * Plain function.
 *
 * @param string $value Value.
 * @return string
 */
function presstrace_fixture_plain( $value ) {
	return $value;
}

/**
 * Function with a by-reference parameter.
 *
 * @param mixed $handle Handle.
 * @return void
 */
function presstrace_fixture_by_ref( &$handle ) {
	$handle = true;
}

/**
 * Class with static, instance, magic and invokable callables.
 */
class PressTrace_Fixture_Callbacks {

	/**
	 * Static method.
	 *
	 * @return int
	 */
	public static function stat() {
		return 1;
	}

	/**
	 * Instance method.
	 *
	 * @return int
	 */
	public function inst() {
		return 2;
	}

	/**
	 * Magic method handler.
	 *
	 * @param string $name Name.
	 * @param array  $args Args.
	 * @return int
	 */
	public function __call( $name, $args ) {
		return 3;
	}

	/**
	 * Invokable.
	 *
	 * @return int
	 */
	public function __invoke() {
		return 4;
	}
}
