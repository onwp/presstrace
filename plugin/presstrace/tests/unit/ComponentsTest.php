<?php
/**
 * Tests for PressTrace_Components.
 *
 * @package PressTrace
 */

use PHPUnit\Framework\TestCase;

class ComponentsTest extends TestCase {

	/**
	 * Resolver under test.
	 *
	 * @var PressTrace_Components
	 */
	private $resolver;

	protected function setUp(): void {
		$GLOBALS['wp_theme_directories'] = array( '/srv/www/wp-content/themes', '/srv/shared-themes' );
		$GLOBALS['wp_plugin_paths']      = array( '/srv/www/wp-content/plugins/linked' => '/opt/src/linked-real' );
		$this->resolver                  = PressTrace_Components::from_environment( '/srv/www/wp-content/plugins/presstrace' );
	}

	protected function tearDown(): void {
		unset( $GLOBALS['wp_theme_directories'], $GLOBALS['wp_plugin_paths'] );
	}

	/**
	 * @dataProvider files
	 */
	public function test_from_file( $file, $expected ) {
		$this->assertSame( $expected, $this->resolver->from_file( $file ) );
	}

	public function files() {
		return array(
			'core include'        => array( '/srv/www/wp-includes/class-wp-hook.php', 'core' ),
			'core admin'          => array( '/srv/www/wp-admin/includes/plugin.php', 'core' ),
			'root file'           => array( '/srv/www/wp-settings.php', 'core' ),
			'plugin in dir'       => array( '/srv/www/wp-content/plugins/woocommerce/includes/class-wc-cart.php', 'plugin:woocommerce' ),
			'single file plugin'  => array( '/srv/www/wp-content/plugins/hello.php', 'plugin:hello' ),
			'mu plugin file'      => array( '/srv/www/wp-content/mu-plugins/my-loader.php', 'mu-plugin:my-loader' ),
			'mu plugin dir'       => array( '/srv/www/wp-content/mu-plugins/tools/inc/a.php', 'mu-plugin:tools' ),
			'theme'               => array( '/srv/www/wp-content/themes/storefront/functions.php', 'theme:storefront' ),
			'custom theme root'   => array( '/srv/shared-themes/child/functions.php', 'theme:child' ),
			'dropin'              => array( '/srv/www/wp-content/object-cache.php', 'dropin:object-cache.php' ),
			'uploads is unknown'  => array( '/srv/www/wp-content/uploads/cache/x.php', 'unknown' ),
			'symlinked plugin'    => array( '/opt/src/linked-real/linked.php', 'plugin:linked' ),
			'outside everything'  => array( '/usr/share/php/Foo.php', 'unknown' ),
			'windows separators'  => array( '\\srv\\www\\wp-content\\plugins\\akismet\\akismet.php', 'plugin:akismet' ),
			'empty'               => array( '', 'unknown' ),
			'space in folder'     => array( '/srv/www/wp-content/plugins/my plugin/main.php', 'plugin:my-plugin' ),
		);
	}

	public function test_relative_paths() {
		$this->assertSame( 'wp-content/plugins/woocommerce/woocommerce.php', $this->resolver->relative( '/srv/www/wp-content/plugins/woocommerce/woocommerce.php' ) );
		$this->assertSame( 'wp-includes/load.php', $this->resolver->relative( '/srv/www/wp-includes/load.php' ) );
		$this->assertSame( 'wp-content/plugins/linked/linked.php', $this->resolver->relative( '/opt/src/linked-real/linked.php' ) );
	}

	public function test_from_frames_skips_core_agent_and_db_dropin() {
		$frames = array(
			array( 'file' => '/srv/www/wp-content/plugins/presstrace/src/class-presstrace-db.php', 'line' => 10, 'function' => 'record' ),
			array( 'file' => '/srv/www/wp-includes/class-wpdb.php', 'line' => 3000, 'function' => 'query' ),
			array( 'file' => '/srv/www/wp-content/db.php', 'line' => 3, 'function' => 'x' ),
			array( 'file' => '/srv/www/wp-includes/option.php', 'line' => 100, 'function' => 'get_results' ),
			array( 'file' => '/srv/www/wp-content/plugins/demo/demo.php', 'line' => 12, 'function' => 'get_option' ),
			array( 'file' => '/srv/www/wp-content/themes/storefront/functions.php', 'line' => 4, 'function' => 'demo' ),
		);
		$this->assertSame( 'plugin:demo', $this->resolver->from_frames( $frames ) );
		$this->assertSame( 'core', $this->resolver->from_frames( array_slice( $frames, 0, 4 ) ) );
		$this->assertSame( 'plugin:ctx', $this->resolver->from_frames( array_slice( $frames, 0, 4 ), 'plugin:ctx' ) );
	}

	public function test_stack_format_and_limit() {
		$frames = array(
			array( 'file' => '/srv/www/wp-content/plugins/presstrace/src/x.php', 'line' => 1, 'function' => 'mine' ),
			array( 'file' => '/srv/www/wp-includes/class-wp-hook.php', 'line' => 309, 'function' => 'add_to_cart', 'class' => 'WC_Form_Handler', 'type' => '::' ),
			array( 'function' => 'no_file' ),
		);
		$this->assertSame( array( 'wp-includes/class-wp-hook.php:309 WC_Form_Handler::add_to_cart' ), $this->resolver->stack( $frames ) );

		$wrapped = array(
			array( 'function' => 'run', 'class' => 'Lab', 'type' => '::' ),
			array( 'file' => '/srv/www/wp-content/plugins/presstrace/src/class-presstrace-callback.php', 'line' => 90, 'function' => 'call_user_func_array' ),
			array( 'file' => '/srv/www/wp-includes/class-wp-hook.php', 'line' => 353, 'function' => '__invoke', 'class' => 'PressTrace_Callback', 'type' => '->' ),
		);
		$this->assertSame( array( 'wp-includes/class-wp-hook.php:353 Lab::run' ), $this->resolver->stack( $wrapped ) );

		$inlined = array(
			array( 'file' => '/srv/www/wp-content/plugins/presstrace/src/class-presstrace-callback.php', 'line' => 90, 'function' => 'run', 'class' => 'Lab', 'type' => '::' ),
			array( 'file' => '/srv/www/wp-includes/class-wp-hook.php', 'line' => 353, 'function' => '__invoke', 'class' => 'PressTrace_Callback', 'type' => '->' ),
		);
		$this->assertSame( array( 'wp-includes/class-wp-hook.php:353 Lab::run' ), $this->resolver->stack( $inlined ) );

		$many = array_fill( 0, 30, array( 'file' => '/srv/www/wp-includes/a.php', 'line' => 1, 'function' => 'f' ) );
		$this->assertCount( 15, $this->resolver->stack( $many ) );
	}

	public function test_describe_callbacks() {
		$plain = PressTrace_Components::describe_callback( 'presstrace_fixture_plain' );
		$this->assertSame( 'presstrace_fixture_plain', $plain['name'] );
		$this->assertFalse( $plain['by_ref'] );
		$this->assertStringEndsWith( 'fixtures/callbacks.php', $plain['file'] );
		$this->assertGreaterThan( 0, $plain['line'] );

		$this->assertTrue( PressTrace_Components::describe_callback( 'presstrace_fixture_by_ref' )['by_ref'] );

		$obj = new PressTrace_Fixture_Callbacks();
		$this->assertSame( 'PressTrace_Fixture_Callbacks::stat', PressTrace_Components::describe_callback( 'PressTrace_Fixture_Callbacks::stat' )['name'] );
		$this->assertSame( 'PressTrace_Fixture_Callbacks::stat', PressTrace_Components::describe_callback( array( 'PressTrace_Fixture_Callbacks', 'stat' ) )['name'] );
		$this->assertSame( 'PressTrace_Fixture_Callbacks->inst', PressTrace_Components::describe_callback( array( $obj, 'inst' ) )['name'] );
		$this->assertSame( 'PressTrace_Fixture_Callbacks->magic', PressTrace_Components::describe_callback( array( $obj, 'magic' ) )['name'] );
		$this->assertSame( 'PressTrace_Fixture_Callbacks->__invoke', PressTrace_Components::describe_callback( $obj )['name'] );

		$closure = PressTrace_Components::describe_callback(
			static function ( &$x ) {
				$x = 1;
			}
		);
		$this->assertSame( '{closure}', $closure['name'] );
		$this->assertTrue( $closure['by_ref'] );

		$this->assertNull( PressTrace_Components::describe_callback( 'presstrace_missing_function' ) );
		$this->assertNull( PressTrace_Components::describe_callback( array( 'Missing_Class', 'x' ) ) );
		$this->assertSame( '', PressTrace_Components::describe_callback( 'strtolower' )['file'] );
	}

	public function test_agent_files_are_ignored() {
		$this->assertTrue( $this->resolver->is_ignored( '/srv/www/wp-content/plugins/presstrace/src/a.php' ) );
		$this->assertFalse( $this->resolver->is_ignored( '/srv/www/wp-content/plugins/presstrace-lab/a.php' ) );
		$this->resolver->ignore( '/srv/www/wp-content/mu-plugins/000-presstrace.php', false );
		$this->assertTrue( $this->resolver->is_ignored( '/srv/www/wp-content/mu-plugins/000-presstrace.php' ) );
	}
}
