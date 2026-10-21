<?php
/**
 * Tests for PressTrace_Namer.
 *
 * @package PressTrace
 */

use PHPUnit\Framework\TestCase;

class NamerTest extends TestCase {

	public function test_types() {
		$this->assertSame( 'cli', PressTrace_Namer::type( array( 'cli' => true, 'cron' => true ) ) );
		$this->assertSame( 'cron', PressTrace_Namer::type( array( 'cron' => true, 'admin' => true ) ) );
		$this->assertSame( 'rest', PressTrace_Namer::type( array( 'rest' => true ) ) );
		$this->assertSame( 'ajax', PressTrace_Namer::type( array( 'ajax' => true, 'admin' => true ) ) );
		$this->assertSame( 'ajax', PressTrace_Namer::type( array( 'wc_ajax' => 'get_refreshed_fragments' ) ) );
		$this->assertSame( 'admin', PressTrace_Namer::type( array( 'admin' => true ) ) );
		$this->assertSame( 'frontend', PressTrace_Namer::type( array() ) );
	}

	public function test_names() {
		$this->assertSame( 'wp-cron', PressTrace_Namer::name( array( 'cron' => true ) ) );
		$this->assertSame( 'wp-cli plugin list', PressTrace_Namer::name( array( 'cli' => true, 'cli_args' => array( '--path=web', 'plugin', 'list', '--format=json' ) ) ) );
		$this->assertSame( 'wp-cli eval', PressTrace_Namer::name( array( 'cli' => true, 'cli_args' => array( 'eval', 'echo 1;' ) ) ) );
		$this->assertSame( 'REST GET /wp/v2/posts/{id}', PressTrace_Namer::name( array( 'rest' => true, 'method' => 'get', 'rest_route' => '/wp/v2/posts/(?P<id>[\d]+)' ) ) );
		$this->assertSame( 'REST POST unmatched', PressTrace_Namer::name( array( 'rest' => true, 'method' => 'POST' ) ) );
		$this->assertSame( 'admin-ajax heartbeat', PressTrace_Namer::name( array( 'ajax' => true, 'ajax_action' => 'heartbeat' ) ) );
		$this->assertSame( 'admin-ajax', PressTrace_Namer::name( array( 'ajax' => true, 'ajax_action' => array( 'x' ) ) ) );
		$this->assertSame( 'wc-ajax add_to_cart', PressTrace_Namer::name( array( 'wc_ajax' => 'add_to_cart' ) ) );
		$this->assertSame( 'wp-admin/edit.php', PressTrace_Namer::name( array( 'admin' => true, 'pagenow' => 'edit.php' ) ) );
		$this->assertSame( 'wp-admin/admin.php?page=wc-settings', PressTrace_Namer::name( array( 'admin' => true, 'pagenow' => 'admin.php', 'admin_page' => 'wc-settings' ) ) );
		$this->assertSame( 'wp-login.php', PressTrace_Namer::name( array( 'script' => 'wp-login.php' ) ) );
		$this->assertSame( 'xmlrpc.php', PressTrace_Namer::name( array( 'xmlrpc' => true ) ) );
		$this->assertSame( 'single-product', PressTrace_Namer::name( array( 'template' => 'single-product' ) ) );
		$this->assertSame( 'unknown', PressTrace_Namer::name( array() ) );
		$this->assertSame( 'unknown', PressTrace_Namer::name( array( 'script' => 'index.php' ) ) );
		$this->assertSame( 'wp-comments-post.php', PressTrace_Namer::name( array( 'script' => 'wp-comments-post.php' ) ) );
		$this->assertSame( 'admin-ajax evilscriptalert1/script', PressTrace_Namer::name( array( 'ajax' => true, 'ajax_action' => 'evil<script>alert(1)</script>' ) ) );
	}

	public function test_templates() {
		$this->assertSame( 'robots.txt', PressTrace_Namer::template( array( 'is_robots' => true, 'is_home' => true ) ) );
		$this->assertSame( 'front-page', PressTrace_Namer::template( array( 'is_front_page' => true, 'is_home' => true ) ) );
		$this->assertSame( 'home', PressTrace_Namer::template( array( 'is_home' => true ) ) );
		$this->assertSame( 'page', PressTrace_Namer::template( array( 'is_page' => true, 'is_singular' => true, 'post_type' => 'page' ) ) );
		$this->assertSame( 'single-product', PressTrace_Namer::template( array( 'is_singular' => true, 'post_type' => 'product' ) ) );
		$this->assertSame( 'archive-product', PressTrace_Namer::template( array( 'is_post_type_archive' => true, 'archive_post_type' => 'product', 'is_archive' => true ) ) );
		$this->assertSame( 'taxonomy-product_cat', PressTrace_Namer::template( array( 'is_tax' => true, 'taxonomy' => 'product_cat', 'is_archive' => true ) ) );
		$this->assertSame( 'search', PressTrace_Namer::template( array( 'is_search' => true ) ) );
		$this->assertSame( '404', PressTrace_Namer::template( array( 'is_404' => true ) ) );
		$this->assertSame( 'sitemap', PressTrace_Namer::template( array( 'sitemap' => 'posts' ) ) );
		$this->assertSame( 'author', PressTrace_Namer::template( array( 'is_author' => true, 'is_archive' => true ) ) );
		$this->assertSame( '', PressTrace_Namer::template( array() ) );
	}

	public function test_rest_route_patterns() {
		$this->assertSame( '/wc/store/v1/cart/items/{key}', PressTrace_Namer::rest_route( '/wc/store/v1/cart/items/(?P<key>[\w-]{32})' ) );
		$this->assertSame( '/wp/v2/posts/{parent}/revisions/{id}', PressTrace_Namer::rest_route( '/wp/v2/posts/(?P<parent>[\d]+)/revisions/(?P<id>[\d]+)' ) );
		$this->assertSame( '/x/{param1}', PressTrace_Namer::rest_route( '/x/(\d+(?:\.\d+)?)' ) );
		$this->assertSame( '/a/{v}/b', PressTrace_Namer::rest_route( '/a/(?P<v>(a|b\)))/b' ) );
		$this->assertSame( '/', PressTrace_Namer::rest_route( '' ) );
	}

	public function test_clean_url() {
		$this->assertSame( 'https://shop.example.com/product/album/', PressTrace_Namer::clean_url( 'https://shop.example.com/product/album/?add-to-cart=1#x' ) );
		$this->assertSame( 'https://api.stripe.com/v1/charges', PressTrace_Namer::clean_url( 'https://user:secret@API.Stripe.com/v1/charges?key=abc' ) );
		$this->assertSame( 'http://localhost:8080/', PressTrace_Namer::clean_url( 'http://localhost:8080' ) );
		$this->assertSame( '/relative/path', PressTrace_Namer::clean_url( '/relative/path?x=1' ) );
		$this->assertSame( 'api.stripe.com', PressTrace_Namer::host( 'https://API.stripe.com/v1' ) );
		$this->assertSame( 'POST', PressTrace_Namer::method( 'post' ) );
		$this->assertSame( 'GET', PressTrace_Namer::method( '' ) );
	}
}
